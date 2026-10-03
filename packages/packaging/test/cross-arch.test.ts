import { expect, it } from "vitest";
import { verifyBinaryTarget } from "../src/binary-target.ts";
import { packageArch, parsePackageArgs } from "../src/package-cli.ts";

it("requires explicit cross mode for a different architecture", () => {
  expect(() => packageArch("windows", "arm64", false, "win32", "x64")).toThrow();
  expect(packageArch("windows", "arm64", true, "win32", "x64")).toBe("arm64");
  expect(packageArch("linux", "aarch64", true, "linux", "x64")).toBe("aarch64");
  expect(() => packageArch("windows", "arm64", true, "linux", "x64")).toThrow();
  expect(() => packageArch("macos", "arm64", true, "win32", "x64")).toThrow();
  expect(() => packageArch("windows", "ia32", true, "win32", "x64")).toThrow();
  expect(parsePackageArgs(["--cross", "--arch=arm64"])).toMatchObject({
    cross: true,
    arch: "arm64",
  });
});

it("checks PE/ELF architecture without executing ARM64 binaries", () => {
  const pe = Buffer.alloc(128);
  pe.writeUInt16LE(0x5a4d, 0);
  pe.writeUInt32LE(64, 0x3c);
  pe.writeUInt32LE(0x4550, 64);
  pe.writeUInt16LE(0xaa64, 68);
  expect(() => verifyBinaryTarget(pe, { os: "windows", arch: "arm64" })).not.toThrow();
  expect(() => verifyBinaryTarget(pe, { os: "windows", arch: "x64" })).toThrow("architecture");
  pe.writeUInt32LE(0xffffffff, 0x3c);
  expect(() => verifyBinaryTarget(pe, { os: "windows", arch: "arm64" })).toThrow();
  const elf = Buffer.alloc(64);
  elf.write("\x7fELF", 0);
  elf[4] = 2;
  elf[5] = 1;
  elf.writeUInt16LE(183, 18);
  expect(() => verifyBinaryTarget(elf, { os: "linux", arch: "aarch64" })).not.toThrow();
  expect(() => verifyBinaryTarget(elf, { os: "linux", arch: "x86_64" })).toThrow();
  expect(() => verifyBinaryTarget(Buffer.alloc(1), { os: "linux", arch: "aarch64" })).toThrow();
});
