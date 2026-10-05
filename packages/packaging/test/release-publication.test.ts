import { expect, it } from "vitest";
import { lookupRelease, publicationAction } from "../src/release-publication.ts";

const candidate = new Map([
  ["app.7z", "a".repeat(64)],
  ["app.7z.sha256", "b".repeat(64)],
]);
const firstAsset = { name: "app.7z", digest: `sha256:${"a".repeat(64)}` };
const secondAsset = { name: "app.7z.sha256", digest: `sha256:${"b".repeat(64)}` };
const assets = [firstAsset, secondAsset];

it("finds a complete draft when the published-tag endpoint returns 404", async () => {
  const requests: string[] = [];
  const release = await lookupRelease(async (endpoint) => {
    requests.push(endpoint);
    if (endpoint === "releases/tags/v3.0.0") return new Response(null, { status: 404 });
    if (endpoint === "releases?per_page=100&page=1")
      return Response.json([{ id: 42, tag_name: "v3.0.0", draft: true }]);
    if (endpoint === "releases/42/assets?per_page=100&page=1") return Response.json(assets);
    throw new Error(`unexpected request: ${endpoint}`);
  }, "v3.0.0");
  expect(release).toEqual({ draft: true, assets });
  expect(publicationAction(candidate, release)).toBe("unchanged");
  expect(requests).toHaveLength(3);
});

it("creates a new draft or resumes only missing assets with identical existing bytes", () => {
  expect(publicationAction(candidate, null)).toBe("upload");
  expect(publicationAction(candidate, { draft: true, assets: assets.slice(0, 1) })).toBe("upload");
});

it("never mutates an identical published release or a complete draft", () => {
  for (const draft of [true, false]) {
    expect(publicationAction(candidate, { draft, assets })).toBe("unchanged");
  }
});

it("rejects silently skipped assets from a previous build of the same tag", () => {
  for (const draft of [true, false]) {
    expect(() =>
      publicationAction(candidate, {
        draft,
        assets: [{ name: "app.7z", digest: `sha256:${"c".repeat(64)}` }, secondAsset],
      }),
    ).toThrow(/different content.*app\.7z/);
  }
});

it("rejects stale matrix entries and duplicate names", () => {
  expect(() =>
    publicationAction(candidate, {
      draft: true,
      assets: [...assets, { name: "macos-offline.dmg", digest: `sha256:${"c".repeat(64)}` }],
    }),
  ).toThrow(/unexpected.*macos-offline/);
  expect(() =>
    publicationAction(candidate, { draft: true, assets: [firstAsset, firstAsset] }),
  ).toThrow(/duplicate/);
});

it("fails closed on missing digests, incomplete published releases, and invalid candidates", () => {
  expect(() =>
    publicationAction(candidate, { draft: true, assets: [{ name: "app.7z", digest: null }] }),
  ).toThrow(/digest/);
  expect(() => publicationAction(candidate, { draft: false, assets: assets.slice(0, 1) })).toThrow(
    /incomplete published/,
  );
  expect(() => publicationAction(new Map(), null)).toThrow(/empty/);
  expect(() => publicationAction(new Map([["app.7z", "bad"]]), null)).toThrow(/candidate digest/);
});
