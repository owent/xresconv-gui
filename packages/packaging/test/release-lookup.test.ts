import { expect, it } from "vitest";
import { lookupRelease } from "../src/release-publication.ts";

it("reads published releases directly and paginates their assets", async () => {
  const page = Array.from({ length: 100 }, (_, index) => ({ name: `app-${index}`, digest: null }));
  const last = [{ name: "last", digest: null }];
  const release = await lookupRelease(async (endpoint) => {
    if (endpoint === "releases/tags/v3%2Ftest")
      return Response.json({ id: 42, tag_name: "v3/test", draft: false });
    if (endpoint === "releases/42/assets?per_page=100&page=1") return Response.json(page);
    if (endpoint === "releases/42/assets?per_page=100&page=2") return Response.json(last);
    throw new Error(`unexpected request: ${endpoint}`);
  }, "v3/test");
  expect(release).toEqual({ draft: false, assets: [...page, ...last] });
});

it("paginates drafts and matches tag_name rather than a release display name", async () => {
  const page = Array.from({ length: 100 }, (_, id) => ({
    id,
    tag_name: `v${id}`,
    name: "v3.0.0",
    draft: true,
  }));
  const release = await lookupRelease(async (endpoint) => {
    if (endpoint === "releases/tags/v3.0.0") return new Response(null, { status: 404 });
    if (endpoint === "releases?per_page=100&page=1") return Response.json(page);
    if (endpoint === "releases?per_page=100&page=2")
      return Response.json([{ id: 200, tag_name: "v3.0.0", name: "Different title", draft: true }]);
    if (endpoint === "releases/200/assets?per_page=100&page=1") return Response.json([]);
    throw new Error(`unexpected request: ${endpoint}`);
  }, "v3.0.0");
  expect(release).toEqual({ draft: true, assets: [] });
});

it("only treats an absent tag and an exhausted release list as a new release", async () => {
  const release = await lookupRelease(async (endpoint) => {
    if (endpoint === "releases/tags/v3.0.0") return new Response(null, { status: 404 });
    if (endpoint === "releases?per_page=100&page=1")
      return Response.json([{ id: 1, tag_name: "other", name: "v3.0.0", draft: true }]);
    throw new Error(`unexpected request: ${endpoint}`);
  }, "v3.0.0");
  expect(release).toBeNull();
});

it("rejects ambiguous drafts even when they occur on different pages", async () => {
  const page = Array.from({ length: 100 }, (_, id) => ({
    id,
    tag_name: id === 0 ? "v3.0.0" : `v${id}`,
    draft: true,
  }));
  await expect(
    lookupRelease(async (endpoint) => {
      if (endpoint === "releases/tags/v3.0.0") return new Response(null, { status: 404 });
      if (endpoint === "releases?per_page=100&page=1") return Response.json(page);
      if (endpoint === "releases?per_page=100&page=2")
        return Response.json([{ id: 200, tag_name: "v3.0.0", draft: true }]);
      throw new Error(`unexpected request: ${endpoint}`);
    }, "v3.0.0"),
  ).rejects.toThrow(/multiple releases/);
});

it.each([401, 403, 500])("fails closed on HTTP %s at every lookup stage", async (status) => {
  for (const stage of ["tag", "list", "assets"]) {
    await expect(
      lookupRelease(async (endpoint) => {
        if (endpoint.startsWith("releases/tags/"))
          return new Response(null, { status: stage === "tag" ? status : 404 });
        if (endpoint.startsWith("releases?"))
          return stage === "list"
            ? new Response(null, { status })
            : Response.json([{ id: 42, tag_name: "v3.0.0", draft: true }]);
        return new Response(null, { status });
      }, "v3.0.0"),
    ).rejects.toThrow(`HTTP ${status}`);
  }
});
