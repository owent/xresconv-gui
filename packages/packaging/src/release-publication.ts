export interface PublishedAsset {
  name: string;
  digest: string | null;
}

export interface ExistingRelease {
  draft: boolean;
  assets: readonly PublishedAsset[];
}

interface ReleaseMetadata {
  id: number;
  tag_name: string;
  draft: boolean;
}

/** Read the release and its complete asset list through the authenticated API. */
export async function lookupRelease(
  api: (endpoint: string) => Promise<Response>,
  tag: string,
): Promise<ExistingRelease | null> {
  const response = await api(`releases/tags/${encodeURIComponent(tag)}`);
  let metadata: ReleaseMetadata | null = null;
  if (response.status === 404) {
    // The tag endpoint only returns published releases. Drafts require the list API.
    for (let page = 1; ; page++) {
      const result = await api(`releases?per_page=100&page=${page}`);
      if (!result.ok) throw new Error(`release list failed: HTTP ${result.status}`);
      const batch = (await result.json()) as ReleaseMetadata[];
      for (const entry of batch) {
        if (entry.tag_name !== tag) continue;
        if (metadata) throw new Error(`multiple releases for tag: ${tag}`);
        metadata = entry;
      }
      if (batch.length < 100) break;
    }
  } else {
    if (!response.ok) throw new Error(`release lookup failed: HTTP ${response.status}`);
    metadata = (await response.json()) as ReleaseMetadata;
  }
  if (!metadata) return null;
  const assets: PublishedAsset[] = [];
  for (let page = 1; ; page++) {
    const result = await api(`releases/${metadata.id}/assets?per_page=100&page=${page}`);
    if (!result.ok) throw new Error(`asset lookup failed: HTTP ${result.status}`);
    const batch = (await result.json()) as PublishedAsset[];
    assets.push(...batch);
    if (batch.length < 100) break;
  }
  return { draft: metadata.draft, assets };
}

/** Compare uploaded release contents with the current candidate artifact set. */
export function publicationAction(
  candidate: ReadonlyMap<string, string>,
  release: ExistingRelease | null,
): "upload" | "unchanged" {
  if (candidate.size === 0) throw new Error("empty candidate artifact set");
  for (const [name, hash] of candidate) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`invalid candidate digest: ${name}`);
  }
  if (release === null) return "upload";
  const existing = new Set<string>();
  for (const asset of release.assets) {
    if (existing.has(asset.name)) throw new Error(`duplicate published asset: ${asset.name}`);
    existing.add(asset.name);
    const expected = candidate.get(asset.name);
    if (!expected) throw new Error(`unexpected published asset: ${asset.name}`);
    if (!asset.digest || !/^sha256:[a-f0-9]{64}$/.test(asset.digest))
      throw new Error(`unverified published digest: ${asset.name}`);
    if (asset.digest !== `sha256:${expected}`)
      throw new Error(`different content for uploaded asset: ${asset.name}`);
  }
  if (existing.size === candidate.size) return "unchanged";
  if (!release.draft) throw new Error("incomplete published release");
  return "upload";
}
