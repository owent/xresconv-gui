//! Versioned application resources. No Tauri types: progress is an injected callback.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub const ARCHIVE_NAME: &str = "app-resources.zip";
const MARKER_NAME: &str = "version.json";
type CacheResult<T> = Result<T, String>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: &'static str,
    pub completed_bytes: u64,
    pub total_bytes: u64,
    pub completed_files: usize,
    pub total_files: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    app_version: String,
    resource_archive: Archive,
    files: Vec<ResourceFile>,
}

#[derive(Deserialize)]
struct Archive {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Deserialize)]
struct ResourceFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Version {
    app_version: String,
    archive_sha256: String,
}

pub struct PreparedRuntime {
    pub node: PathBuf,
    pub entry: PathBuf,
    // Keep the shared usage lock until the shell and its children have stopped.
    _usage: File,
}

pub fn find_installation(
    candidates: impl IntoIterator<Item = PathBuf>,
    allow_development: bool,
) -> CacheResult<Option<PathBuf>> {
    let root = candidates.into_iter().find(|root| {
        root.join(ARCHIVE_NAME).exists() || root.join("runtime-manifest.json").exists()
    });
    if root.is_none() && !allow_development {
        return Err("application resource archive and runtime manifest are missing".into());
    }
    Ok(root)
}

fn io_error(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}

fn digest(reader: &mut impl Read) -> CacheResult<String> {
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|e| io_error("read resource", e))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn valid_path(name: &str) -> bool {
    name.starts_with("app/")
        && !name.contains(['\\', ':', '\0'])
        && name
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn ensure_directory(path: &Path) -> CacheResult<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if !meta.file_type().is_symlink() && meta.is_dir() => Ok(()),
        Ok(_) => Err(format!(
            "cache path is not a regular directory: {}",
            path.display()
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|e| io_error("create resource cache", e))
        }
        Err(e) => Err(io_error("inspect resource cache", e)),
    }
}

fn open_lock(path: &Path) -> CacheResult<File> {
    if let Ok(meta) = fs::symlink_metadata(path)
        && (!meta.is_file() || meta.file_type().is_symlink())
    {
        return Err("resource cache lock is not a regular file".into());
    }
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|e| io_error("open resource cache lock", e))
}

/// Delete only our fixed payload subtree. Never follow a link while clearing it.
fn remove_payload(path: &Path) -> CacheResult<()> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(value) => value,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(io_error("inspect old resource cache", e)),
    };
    if metadata.file_type().is_symlink() {
        #[cfg(windows)]
        if metadata.is_dir() {
            return fs::remove_dir(path).map_err(|e| io_error("remove cache directory link", e));
        }
        return fs::remove_file(path).map_err(|e| io_error("remove cache link", e));
    }
    #[cfg(windows)]
    if metadata.permissions().readonly() {
        let mut permissions = metadata.permissions();
        // Windows read-only attributes do not change Unix access permissions.
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions).map_err(|e| io_error("clear read-only cache", e))?;
    }
    #[cfg(unix)]
    if metadata.is_dir() {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|e| io_error("make old cache traversable", e))?;
    }
    if metadata.is_dir() {
        for item in fs::read_dir(path).map_err(|e| io_error("list old resource cache", e))? {
            remove_payload(
                &item
                    .map_err(|e| io_error("read old resource cache entry", e))?
                    .path(),
            )?;
        }
        fs::remove_dir(path).map_err(|e| io_error("delete old resource cache directory", e))?;
    } else {
        fs::remove_file(path).map_err(|e| io_error("delete old resource cache file", e))?;
    }
    if fs::symlink_metadata(path).is_ok() {
        return Err(format!("old resource cache remains: {}", path.display()));
    }
    Ok(())
}

fn expected_entries(files: &[ResourceFile]) -> CacheResult<BTreeMap<String, ResourceFile>> {
    let mut expected = BTreeMap::new();
    let mut folded = BTreeSet::new();
    for file in files.iter().filter(|file| file.path.starts_with("app/")) {
        if !valid_path(&file.path)
            || !valid_hash(&file.sha256)
            || !folded.insert(file.path.to_lowercase())
            || expected.insert(file.path.clone(), file.clone()).is_some()
        {
            return Err(format!("invalid resource inventory: {}", file.path));
        }
    }
    for required in [
        "app/guardian/service.mjs",
        "app/backend/service.mjs",
        "app/script-host/worker.mjs",
    ] {
        if !expected.contains_key(required) {
            return Err(format!("resource entry missing: {required}"));
        }
    }
    Ok(expected)
}

fn cache_matches(
    payload: &Path,
    version: &Version,
    expected: &BTreeMap<String, ResourceFile>,
) -> bool {
    let check = || -> CacheResult<bool> {
        let meta = fs::symlink_metadata(payload).map_err(|e| io_error("inspect cache", e))?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Ok(false);
        }
        let marker = payload.join(MARKER_NAME);
        let marker_meta =
            fs::symlink_metadata(&marker).map_err(|e| io_error("inspect version marker", e))?;
        if !marker_meta.is_file() || marker_meta.file_type().is_symlink() {
            return Ok(false);
        }
        let recorded: Version = serde_json::from_slice(
            &fs::read(&marker).map_err(|e| io_error("read cache version", e))?,
        )
        .map_err(|e| io_error("parse cache version", e))?;
        if &recorded != version {
            return Ok(false);
        }
        let mut wanted = BTreeSet::from([MARKER_NAME.to_string()]);
        for name in expected.keys() {
            wanted.insert(name.clone());
            let mut parent = Path::new(name).parent();
            while let Some(dir) = parent.filter(|p| !p.as_os_str().is_empty()) {
                wanted.insert(dir.to_string_lossy().replace('\\', "/"));
                parent = dir.parent();
            }
        }
        let mut actual = BTreeSet::new();
        let mut stack = vec![payload.to_path_buf()];
        while let Some(dir) = stack.pop() {
            for item in fs::read_dir(dir).map_err(|e| io_error("list cache", e))? {
                let item = item.map_err(|e| io_error("read cache entry", e))?;
                let path = item.path();
                let meta =
                    fs::symlink_metadata(&path).map_err(|e| io_error("inspect cached entry", e))?;
                if meta.file_type().is_symlink() {
                    return Ok(false);
                }
                let name = path
                    .strip_prefix(payload)
                    .map_err(|e| io_error("cache boundary", e))?
                    .to_string_lossy()
                    .replace('\\', "/");
                actual.insert(name.clone());
                if meta.is_dir() {
                    stack.push(path);
                } else if name != MARKER_NAME {
                    let Some(file) = expected.get(&name) else {
                        return Ok(false);
                    };
                    if !meta.is_file()
                        || meta.len() != file.size
                        || digest(
                            &mut File::open(path).map_err(|e| io_error("read cached file", e))?,
                        )? != file.sha256
                    {
                        return Ok(false);
                    }
                }
            }
        }
        Ok(actual == wanted)
    };
    check().unwrap_or(false)
}

/// A preparation lock serializes validation/update; a usage lock protects live runtimes.
pub fn prepare(
    install_root: &Path,
    cache_root: &Path,
    app_version: &str,
    progress: &mut impl FnMut(Progress),
) -> CacheResult<PreparedRuntime> {
    progress(Progress {
        phase: "verifying",
        completed_bytes: 0,
        total_bytes: 0,
        completed_files: 0,
        total_files: 0,
    });
    let manifest: Manifest = serde_json::from_slice(
        &fs::read(install_root.join("runtime-manifest.json"))
            .map_err(|e| io_error("read runtime manifest", e))?,
    )
    .map_err(|e| io_error("parse runtime manifest", e))?;
    if manifest.app_version != app_version
        || manifest.resource_archive.path != ARCHIVE_NAME
        || !valid_hash(&manifest.resource_archive.sha256)
    {
        return Err("application version/resource archive identity mismatch".into());
    }
    let expected = expected_entries(&manifest.files)?;
    let total_bytes = expected
        .values()
        .try_fold(0u64, |total, file| total.checked_add(file.size))
        .ok_or("resource size overflow")?;
    let mut status = Progress {
        phase: "verifying",
        completed_bytes: 0,
        total_bytes,
        completed_files: 0,
        total_files: expected.len(),
    };
    let node = install_root
        .join("runtime")
        .join(if cfg!(windows) { "node.exe" } else { "node" });
    if !node.is_file() {
        return Err("bundled Node runtime missing".into());
    }
    let mut source = File::open(install_root.join(ARCHIVE_NAME))
        .map_err(|e| io_error("open application resources", e))?;
    if source
        .metadata()
        .map_err(|e| io_error("stat application resources", e))?
        .len()
        != manifest.resource_archive.size
        || digest(&mut source)? != manifest.resource_archive.sha256
    {
        return Err("application resource archive size/SHA-256 mismatch".into());
    }
    source
        .seek(SeekFrom::Start(0))
        .map_err(|e| io_error("rewind resource archive", e))?;
    let mut archive = zip::ZipArchive::new(source).map_err(|e| io_error("open resource ZIP", e))?;
    if archive.len() != expected.len() {
        return Err("resource ZIP entry count mismatch".into());
    }
    let mut seen = BTreeSet::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|e| io_error("read ZIP entry", e))?;
        let name = entry.name();
        if !valid_path(name)
            || entry.enclosed_name().is_none()
            || !entry.is_file()
            || entry.encrypted()
            || !seen.insert(name.to_string())
        {
            return Err(format!("invalid resource ZIP entry: {name}"));
        }
        if expected
            .get(name)
            .is_none_or(|file| file.size != entry.size())
        {
            return Err(format!("resource ZIP inventory mismatch: {name}"));
        }
    }
    fs::create_dir_all(cache_root).map_err(|e| io_error("create app cache root", e))?;
    ensure_directory(cache_root)?;
    // One active cache per application, including upgrades installed at a new path.
    // This also remains stable across AppImage mount paths and versioned filenames.
    let base = cache_root.join("resources");
    ensure_directory(&base)?;
    let preparation = open_lock(&base.join("prepare.lock"))?;
    preparation.try_lock().map_err(|e| {
        io_error(
            "another instance is preparing application resources; retry when it finishes",
            e,
        )
    })?;
    let usage = open_lock(&base.join("usage.lock"))?;
    let payload = base.join("payload");
    let version = Version {
        app_version: app_version.into(),
        archive_sha256: manifest.resource_archive.sha256,
    };
    usage
        .try_lock_shared()
        .map_err(|e| io_error("resource cache is being updated", e))?;
    if !cache_matches(&payload, &version, &expected) {
        usage
            .unlock()
            .map_err(|e| io_error("release cache read lock", e))?;
        usage.try_lock().map_err(|e| {
            io_error(
                "resource cache is in use; close the previous application instance and retry",
                e,
            )
        })?;
        status.phase = "cleaning";
        progress(status.clone());
        remove_payload(&payload)?;
        let extracted = (|| -> CacheResult<()> {
            ensure_directory(&payload)?;
            status.phase = "extracting";
            progress(status.clone());
            let mut last_progress = Instant::now();
            let mut buffer = [0u8; 64 * 1024];
            for index in 0..archive.len() {
                let mut entry = archive
                    .by_index(index)
                    .map_err(|e| io_error("read resource ZIP", e))?;
                let file = expected
                    .get(entry.name())
                    .ok_or("resource ZIP entry missing from inventory")?;
                let dest = payload.join(&file.path);
                fs::create_dir_all(dest.parent().ok_or("resource path has no parent")?)
                    .map_err(|e| io_error("create extracted directory", e))?;
                let mut output =
                    File::create_new(&dest).map_err(|e| io_error("create extracted file", e))?;
                let mut hasher = Sha256::new();
                let mut written = 0u64;
                loop {
                    let count = entry
                        .read(&mut buffer)
                        .map_err(|e| io_error("decompress resource", e))?;
                    if count == 0 {
                        break;
                    }
                    written += count as u64;
                    if written > file.size {
                        return Err(format!("resource size exceeded: {}", file.path));
                    }
                    output
                        .write_all(&buffer[..count])
                        .map_err(|e| io_error("write extracted resource", e))?;
                    hasher.update(&buffer[..count]);
                    status.completed_bytes += count as u64;
                    if last_progress.elapsed() >= Duration::from_millis(50) {
                        progress(status.clone());
                        last_progress = Instant::now();
                    }
                }
                if written != file.size || format!("{:x}", hasher.finalize()) != file.sha256 {
                    return Err(format!(
                        "extracted resource size/SHA-256 mismatch: {}",
                        file.path
                    ));
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    output
                        .set_permissions(fs::Permissions::from_mode(
                            entry.unix_mode().unwrap_or(0o644) & 0o777,
                        ))
                        .map_err(|e| io_error("set extracted permissions", e))?;
                }
                status.completed_files += 1;
            }
            progress(status.clone());
            let marker = serde_json::to_vec_pretty(&version)
                .map_err(|e| io_error("serialize cache version", e))?;
            let mut output = File::create_new(payload.join(MARKER_NAME))
                .map_err(|e| io_error("create cache version", e))?;
            output
                .write_all(&marker)
                .map_err(|e| io_error("write cache version", e))?;
            output
                .sync_all()
                .map_err(|e| io_error("commit cache version", e))?;
            Ok(())
        })();
        if let Err(error) = extracted {
            return match remove_payload(&payload) {
                Ok(()) => Err(error),
                Err(cleanup) => Err(format!(
                    "{error}; incomplete cache cleanup failed: {cleanup}"
                )),
            };
        }
        usage
            .unlock()
            .map_err(|e| io_error("release cache update lock", e))?;
        usage
            .try_lock_shared()
            .map_err(|e| io_error("retain cache usage lock", e))?;
    }
    status.phase = "ready";
    status.completed_bytes = total_bytes;
    status.completed_files = expected.len();
    progress(status);
    Ok(PreparedRuntime {
        node,
        entry: payload.join("app/guardian/service.mjs"),
        _usage: usage,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use zip::write::SimpleFileOptions;

    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture {
        root: PathBuf,
        install: PathBuf,
        cache: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let root = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .join("build/resource-cache-tests")
                .join(format!(
                    "{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ));
            let install = root.join("安装 路径");
            let cache = root.join("缓存");
            fs::create_dir_all(install.join("runtime")).unwrap();
            fs::write(
                install
                    .join("runtime")
                    .join(if cfg!(windows) { "node.exe" } else { "node" }),
                b"node",
            )
            .unwrap();
            Self {
                root,
                install,
                cache,
            }
        }
        fn write(&self, version: &str, content: &str) {
            let source = File::create(self.install.join(ARCHIVE_NAME)).unwrap();
            let mut zip = zip::ZipWriter::new(source);
            let mut files = Vec::new();
            for name in [
                "app/guardian/service.mjs",
                "app/backend/service.mjs",
                "app/script-host/worker.mjs",
                "app/node_modules/包/资源.txt",
            ] {
                zip.start_file(
                    name,
                    SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated)
                        .unix_permissions(0o755),
                )
                .unwrap();
                zip.write_all(content.as_bytes()).unwrap();
                files.push(serde_json::json!({"path": name, "size": content.len(), "sha256": format!("{:x}", Sha256::digest(content.as_bytes()))}));
            }
            zip.finish().unwrap();
            let archive = fs::read(self.install.join(ARCHIVE_NAME)).unwrap();
            fs::write(self.install.join("runtime-manifest.json"), serde_json::to_vec(&serde_json::json!({
                "appVersion": version, "resourceArchive": {"path": ARCHIVE_NAME, "size": archive.len(), "sha256": format!("{:x}", Sha256::digest(&archive))}, "files": files,
            })).unwrap()).unwrap();
        }
        fn prepare(&self, version: &str) -> CacheResult<PreparedRuntime> {
            prepare(&self.install, &self.cache, version, &mut |_| {})
        }
        fn change_manifest(&self, change: impl FnOnce(&mut serde_json::Value)) {
            let path = self.install.join("runtime-manifest.json");
            let mut value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            change(&mut value);
            fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            remove_payload(&self.root).unwrap();
        }
    }
    fn payload(runtime: &PreparedRuntime) -> PathBuf {
        runtime.entry.ancestors().nth(3).unwrap().to_path_buf()
    }

    #[test]
    fn missing_release_resources_block_startup_but_development_is_allowed() {
        let fixture = Fixture::new();
        let candidates = vec![fixture.install.clone()];
        assert!(find_installation(candidates.clone(), false).is_err());
        assert!(
            find_installation(candidates.clone(), true)
                .unwrap()
                .is_none()
        );
        fs::write(fixture.install.join(ARCHIVE_NAME), b"broken ZIP").unwrap();
        assert_eq!(
            find_installation(candidates, false).unwrap(),
            Some(fixture.install.clone())
        );
        assert!(fixture.prepare("1.0.0").is_err());
    }

    #[test]
    fn moved_installations_reuse_and_update_the_same_cache() {
        let mut fixture = Fixture::new();
        fixture.write("1.0.0", "old");
        let original_install = fixture.install.clone();
        let first = fixture.prepare("1.0.0").unwrap();
        let original_payload = payload(&first);
        drop(first);
        // Moving an installation or remounting an AppImage must not create another cache.
        fixture.install = fixture.root.join("new-mount");
        fs::rename(&original_install, &fixture.install).unwrap();
        let mut events = Vec::new();
        let reused = prepare(&fixture.install, &fixture.cache, "1.0.0", &mut |p| {
            events.push(p)
        })
        .unwrap();
        assert_eq!(payload(&reused), original_payload);
        assert!(!events.iter().any(|p| p.phase == "extracting"));
        drop(reused);
        fs::write(original_payload.join("obsolete.txt"), b"old").unwrap();
        fixture.write("2.0.0", "updated");
        let updated = fixture.prepare("2.0.0").unwrap();
        assert_eq!(payload(&updated), original_payload);
        assert!(!original_payload.join("obsolete.txt").exists());
        assert_eq!(fs::read_to_string(&updated.entry).unwrap(), "updated");
        assert_eq!(original_payload, fixture.cache.join("resources/payload"));
    }

    #[test]
    fn first_extraction_records_version_and_reports_actual_progress() {
        let fixture = Fixture::new();
        fixture.write("1.0.0", "你好 resources");
        let mut events = Vec::new();
        let runtime = prepare(&fixture.install, &fixture.cache, "1.0.0", &mut |p| {
            events.push(p)
        })
        .unwrap();
        assert_eq!(
            fs::read_to_string(&runtime.entry).unwrap(),
            "你好 resources"
        );
        let marker: Version =
            serde_json::from_slice(&fs::read(payload(&runtime).join(MARKER_NAME)).unwrap())
                .unwrap();
        assert_eq!(marker.app_version, "1.0.0");
        assert_eq!(marker.archive_sha256.len(), 64);
        assert_eq!(events.first().unwrap().phase, "verifying");
        assert!(events.iter().any(|p| p.phase == "cleaning"));
        assert!(
            events
                .iter()
                .any(|p| p.phase == "extracting" && p.completed_bytes == 0)
        );
        let done = events.last().unwrap();
        assert_eq!(done.phase, "ready");
        assert_eq!(done.completed_files, 4);
        assert_eq!(done.completed_bytes, done.total_bytes);
        assert!(
            events
                .windows(2)
                .all(|p| p[0].completed_bytes <= p[1].completed_bytes)
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&runtime.entry).unwrap().permissions().mode() & 0o777,
                0o755
            );
        }
    }

    #[test]
    fn concurrent_instances_reuse_a_valid_cache_without_reextracting() {
        let fixture = Fixture::new();
        fixture.write("1.0.0", "same");
        let first = fixture.prepare("1.0.0").unwrap();
        let marker = payload(&first).join(MARKER_NAME);
        let before = fs::metadata(&marker).unwrap().modified().unwrap();
        let mut phases = Vec::new();
        let second = prepare(&fixture.install, &fixture.cache, "1.0.0", &mut |p| {
            phases.push(p.phase)
        })
        .unwrap();
        assert_eq!(first.entry, second.entry);
        assert_eq!(before, fs::metadata(marker).unwrap().modified().unwrap());
        assert_eq!(phases, ["verifying", "ready"]);
    }

    #[test]
    fn upgrades_delete_unknown_files_empty_directories_and_readonly_files_before_extraction() {
        let fixture = Fixture::new();
        fixture.write("1.0.0", "old");
        let first = fixture.prepare("1.0.0").unwrap();
        let old = payload(&first);
        drop(first);
        let stale = old.join("untracked/sub/stale.js");
        fs::create_dir_all(stale.parent().unwrap()).unwrap();
        fs::write(&stale, b"old").unwrap();
        let mut permissions = fs::metadata(&stale).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&stale, permissions).unwrap();
        fs::create_dir_all(old.join("untracked/empty")).unwrap();
        fixture.write("2.0.0", "new");
        let mut cleared_before_extracting = false;
        let second = prepare(&fixture.install, &fixture.cache, "2.0.0", &mut |p| {
            if p.phase == "extracting" && p.completed_bytes == 0 {
                cleared_before_extracting =
                    !old.join("untracked").exists() && !old.join(MARKER_NAME).exists();
            }
        })
        .unwrap();
        assert!(cleared_before_extracting);
        assert!(!old.join("untracked").exists());
        assert_eq!(fs::read_to_string(second.entry).unwrap(), "new");
    }

    #[test]
    fn same_version_with_different_archive_rebuilds() {
        let fixture = Fixture::new();
        fixture.write("1.0.0", "first");
        let first = fixture.prepare("1.0.0").unwrap();
        let old = payload(&first);
        drop(first);
        fs::write(old.join("obsolete.mjs"), "old").unwrap();
        fixture.write("1.0.0", "second");
        let second = fixture.prepare("1.0.0").unwrap();
        assert!(!old.join("obsolete.mjs").exists());
        assert_eq!(fs::read_to_string(second.entry).unwrap(), "second");
    }

    #[test]
    fn damaged_missing_or_incomplete_cache_is_fully_rebuilt() {
        for damage in ["bytes", "missing", "marker", "unknown"] {
            let fixture = Fixture::new();
            fixture.write("1.0.0", "original");
            let first = fixture.prepare("1.0.0").unwrap();
            let old = payload(&first);
            match damage {
                "bytes" => fs::write(&first.entry, "modified").unwrap(),
                "missing" => fs::remove_file(&first.entry).unwrap(),
                "marker" => fs::remove_file(old.join(MARKER_NAME)).unwrap(),
                _ => fs::create_dir(old.join("empty-leftover")).unwrap(),
            }
            drop(first);
            let second = fixture.prepare("1.0.0").unwrap();
            assert_eq!(fs::read_to_string(second.entry).unwrap(), "original");
            assert!(!old.join("empty-leftover").exists());
        }
    }

    #[test]
    fn a_live_old_instance_prevents_deletion_and_allows_retry_after_exit() {
        let fixture = Fixture::new();
        fixture.write("1.0.0", "old");
        let old = fixture.prepare("1.0.0").unwrap();
        fixture.write("2.0.0", "new");
        let error = fixture.prepare("2.0.0").err().unwrap();
        assert!(
            error.contains("close the previous application instance"),
            "{error}"
        );
        assert_eq!(fs::read_to_string(&old.entry).unwrap(), "old");
        drop(old);
        assert!(fixture.prepare("2.0.0").is_ok());
    }

    #[test]
    fn failed_extraction_removes_partial_files_and_never_commits_a_version() {
        let fixture = Fixture::new();
        fixture.write("1.0.0", "old");
        let old = fixture.prepare("1.0.0").unwrap();
        let dir = payload(&old);
        drop(old);
        fixture.write("2.0.0", "new");
        fixture.change_manifest(|m| m["files"][0]["sha256"] = "0".repeat(64).into());
        let error = fixture.prepare("2.0.0").err().unwrap();
        assert!(error.contains("extracted resource size/SHA-256 mismatch"));
        assert!(!dir.exists());
        fixture.write("2.0.0", "new");
        assert!(fixture.prepare("2.0.0").is_ok());
    }

    #[test]
    fn bad_archive_is_rejected_before_clearing_the_existing_cache() {
        let fixture = Fixture::new();
        fixture.write("1.0.0", "old");
        let first = fixture.prepare("1.0.0").unwrap();
        let entry = first.entry.clone();
        drop(first);
        fixture.write("2.0.0", "new");
        fs::write(fixture.install.join(ARCHIVE_NAME), b"broken").unwrap();
        assert!(
            fixture
                .prepare("2.0.0")
                .err()
                .unwrap()
                .contains("archive size/SHA-256 mismatch")
        );
        assert_eq!(fs::read_to_string(entry).unwrap(), "old");
    }

    #[test]
    fn invalid_paths_duplicate_inventory_and_wrong_version_fail_before_writing() {
        for name in [
            "app/../escape.js",
            "app/C:/escape.js",
            "app/./escape.js",
            "app/\\escape.js",
        ] {
            let fixture = Fixture::new();
            fixture.write("1.0.0", "data");
            fixture.change_manifest(|m| m["files"][0]["path"] = name.into());
            assert!(fixture.prepare("1.0.0").is_err());
            assert!(!fixture.cache.exists());
        }
        let fixture = Fixture::new();
        fixture.write("1.0.0", "data");
        fixture.change_manifest(|m| {
            let duplicate = m["files"][0].clone();
            m["files"].as_array_mut().unwrap().push(duplicate);
        });
        assert!(fixture.prepare("1.0.0").is_err());
        fixture.write("1.0.0", "data");
        assert!(fixture.prepare("2.0.0").is_err());
    }

    #[test]
    fn malformed_zip_names_and_symlinks_are_rejected_before_clearing_cache() {
        for invalid in ["parent", "unexpected", "symlink"] {
            let fixture = Fixture::new();
            fixture.write("1.0.0", "old");
            let runtime = fixture.prepare("1.0.0").unwrap();
            let old_entry = runtime.entry.clone();
            drop(runtime);
            fixture.write("2.0.0", "new");
            let mut zip =
                zip::ZipWriter::new(File::create(fixture.install.join(ARCHIVE_NAME)).unwrap());
            for name in [
                "app/guardian/service.mjs",
                "app/backend/service.mjs",
                "app/script-host/worker.mjs",
            ] {
                zip.start_file(name, SimpleFileOptions::default()).unwrap();
                zip.write_all(b"new").unwrap();
            }
            if invalid == "symlink" {
                zip.add_symlink(
                    "app/node_modules/包/资源.txt",
                    "../../../outside",
                    SimpleFileOptions::default(),
                )
                .unwrap();
            } else {
                zip.start_file(
                    if invalid == "parent" {
                        "app/../escape.js"
                    } else {
                        "app/unexpected.js"
                    },
                    SimpleFileOptions::default(),
                )
                .unwrap();
                zip.write_all(b"new").unwrap();
            }
            zip.finish().unwrap();
            let bytes = fs::read(fixture.install.join(ARCHIVE_NAME)).unwrap();
            fixture.change_manifest(|m| {
                m["resourceArchive"]["size"] = bytes.len().into();
                m["resourceArchive"]["sha256"] = format!("{:x}", Sha256::digest(bytes)).into();
            });
            assert!(fixture.prepare("2.0.0").is_err());
            assert_eq!(fs::read_to_string(old_entry).unwrap(), "old");
            assert!(!fixture.root.join("escape.js").exists());
        }
    }

    #[test]
    fn another_installation_cannot_replace_a_live_cache_and_rebuilds_after_exit() {
        let first_fixture = Fixture::new();
        first_fixture.write("1.0.0", "first");
        let first = first_fixture.prepare("1.0.0").unwrap();
        let second_fixture = Fixture::new();
        second_fixture.write("2.0.0", "second");
        assert!(
            prepare(
                &second_fixture.install,
                &first_fixture.cache,
                "2.0.0",
                &mut |_| {},
            )
            .is_err()
        );
        assert_eq!(fs::read_to_string(&first.entry).unwrap(), "first");
        let old_payload = payload(&first);
        drop(first);
        fs::write(old_payload.join("old-installation.js"), b"old").unwrap();
        let second = prepare(
            &second_fixture.install,
            &first_fixture.cache,
            "2.0.0",
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(payload(&second), old_payload);
        assert!(!old_payload.join("old-installation.js").exists());
        assert_eq!(fs::read_to_string(&second.entry).unwrap(), "second");
        drop(second);
    }

    #[cfg(windows)]
    #[test]
    fn locked_file_stops_cleanup_before_any_new_resource_is_extracted() {
        use std::os::windows::fs::OpenOptionsExt;
        let fixture = Fixture::new();
        fixture.write("1.0.0", "old");
        let first = fixture.prepare("1.0.0").unwrap();
        let dir = payload(&first);
        drop(first);
        let stale = dir.join("locked.js");
        fs::write(&stale, "locked").unwrap();
        let locked = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&stale)
            .unwrap();
        fixture.write("2.0.0", "new");
        let mut extracting = false;
        assert!(
            prepare(&fixture.install, &fixture.cache, "2.0.0", &mut |p| {
                extracting |= p.phase == "extracting";
            })
            .is_err()
        );
        assert!(!extracting);
        drop(locked);
        let second = fixture.prepare("2.0.0").unwrap();
        assert!(!stale.exists());
        assert_eq!(fs::read_to_string(second.entry).unwrap(), "new");
    }

    #[cfg(unix)]
    #[test]
    fn deleting_a_stale_symlink_preserves_its_target() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        fixture.write("1.0.0", "old");
        let first = fixture.prepare("1.0.0").unwrap();
        let dir = payload(&first);
        drop(first);
        let outside = fixture.root.join("user-data");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("preserve"), "user").unwrap();
        symlink(&outside, dir.join("link")).unwrap();
        fixture.write("2.0.0", "new");
        let second = fixture.prepare("2.0.0").unwrap();
        assert!(!dir.join("link").exists());
        assert!(outside.join("preserve").exists());
        drop(second);
    }
}
