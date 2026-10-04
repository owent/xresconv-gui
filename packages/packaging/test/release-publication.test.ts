import { expect, it } from "vitest";
import { publicationAction } from "../src/release-publication.ts";

const candidate = new Map([
  ["app.7z", "a".repeat(64)],
  ["app.7z.sha256", "b".repeat(64)],
]);
const firstAsset = { name: "app.7z", digest: `sha256:${"a".repeat(64)}` };
const secondAsset = { name: "app.7z.sha256", digest: `sha256:${"b".repeat(64)}` };
const assets = [firstAsset, secondAsset];

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
