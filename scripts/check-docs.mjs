import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function checkDocs(root) {
  const ignored = new Set([
    "node_modules",
    "build",
    "dist",
    "target",
    "out",
    "worktrees",
  ]);
  const files = [];
  function collect(dir) {
    for (const entry of readdirSync(path.join(root, dir), {
      withFileTypes: true,
    })) {
      const relative = path.join(dir, entry.name);
      if (entry.isDirectory() && !ignored.has(entry.name)) collect(relative);
      else if (entry.isFile() && entry.name.endsWith(".md"))
        files.push(relative);
    }
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(entry.name);
  }
  for (const dir of [
    "docs",
    ".agents/skills",
    ".github/actions",
    "tests/fixtures",
    "tests/docs",
  ])
    collect(dir);

  const slug = (heading) =>
    heading
      .toLowerCase()
      .replace(/[`*_~]/g, "")
      .replace(/[^\p{L}\p{N}\p{M}\- _]/gu, "")
      .replace(/ /g, "-");
  function prose(source) {
    let fence;
    return source
      .split(/\r?\n/)
      .map((line) => {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker && !fence) {
          fence = marker;
          return "";
        }
        if (fence) {
          if (marker?.[0] === fence[0] && marker.length >= fence.length)
            fence = undefined;
          return "";
        }
        return line;
      })
      .join("\n");
  }
  function anchors(file) {
    const result = new Set();
    const counts = new Map();
    for (const match of prose(readFileSync(file, "utf8")).matchAll(
      /^#{1,6}\s+(.+)$/gm,
    )) {
      const base = slug(match[1].replace(/\s+#+\s*$/, ""));
      const count = counts.get(base) ?? 0;
      result.add(count ? `${base}-${count}` : base);
      counts.set(base, count + 1);
    }
    return result;
  }

  const errors = [];
  for (const file of files) {
    const absolute = path.join(root, file);
    const source = prose(readFileSync(absolute, "utf8"));
    const links = [
      ...source.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g),
    ].map((match) => match[1]);
    links.push(
      ...[...source.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)].map(
        (match) => match[1],
      ),
    );
    for (const link of links) {
      if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(link)) continue;
      const [target, fragment] = link.replace(/^<|>$/g, "").split("#", 2);
      let destination;
      try {
        destination = target
          ? path.resolve(path.dirname(absolute), decodeURIComponent(target))
          : absolute;
      } catch {
        errors.push(`${file}: invalid URL ${link}`);
        continue;
      }
      if (!existsSync(destination))
        errors.push(`${file}: missing target ${link}`);
      else if (
        fragment &&
        destination.endsWith(".md") &&
        !anchors(destination).has(decodeURIComponent(fragment))
      ) {
        errors.push(`${file}: missing heading ${link}`);
      }
    }
  }
  return { errors, fileCount: files.length };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = checkDocs(fileURLToPath(new URL("../", import.meta.url)));
  if (result.errors.length) {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  } else
    console.log(
      `Documentation links passed (${result.fileCount} Markdown files).`,
    );
}
