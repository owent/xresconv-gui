import { describe, expect, it } from "vitest";
import { assertWellFormed, checkWellFormed } from "../src/config/check-well-formed.js";

describe("checkWellFormed (BD-07 strict XML)", () => {
  it("accepts well-formed XML", () => {
    expect(checkWellFormed('<root><item name="a"/></root>')).toBeNull();
  });

  it("rejects malformed XML with a location", () => {
    // Legacy GUI tolerated this via HTML parsing; the new parser must fail.
    const loc = checkWellFormed("<root><item></root>");
    expect(loc).not.toBeNull();
    expect(loc?.line).toBeGreaterThan(0);
  });

  it("rejects unclosed tags from the fault fixture shape", () => {
    const loc = checkWellFormed("<root>\n  <item name='x'>\n</root>");
    expect(loc).not.toBeNull();
  });

  it("assertWellFormed throws a locatable ConfigError", () => {
    expect(() => assertWellFormed("<root><item></root>", "conv.xml")).toThrowError(
      /conv\.xml: malformed XML at line \d+/,
    );
  });

  it("keeps script text with < > & readable inside <script> elements", () => {
    // <script> is NOT special-cased by the new parser (BD-07): all script
    // bodies follow one rule. Here only well-formedness matters.
    expect(
      checkWellFormed("<root><script>if (a &gt; 0 &amp;&amp; b &lt; 2) { go(); }</script></root>"),
    ).toBeNull();
  });
});
