export interface PublishedAsset {
  name: string;
  digest: string | null;
}

export interface ExistingRelease {
  draft: boolean;
  assets: readonly PublishedAsset[];
}

/** Same tag is not proof of the same build. Never overwrite or re-draft a public release. */
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
      throw new Error(`different content for existing asset: ${asset.name}; use a new version/tag`);
  }
  if (existing.size === candidate.size) return "unchanged";
  if (!release.draft) throw new Error("incomplete published release; use a new version/tag");
  return "upload";
}
