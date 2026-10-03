import type { ReleaseTarget } from "./types.ts";

/** Inspect executable headers without starting a target runtime. */
export function verifyBinaryTarget(data: Buffer, target: Pick<ReleaseTarget, "os" | "arch">): void {
  const arm = target.arch === "arm64" || target.arch === "aarch64";
  let valid = false;
  if (target.os === "windows" && data.length >= 64 && data.readUInt16LE(0) === 0x5a4d) {
    const offset = data.readUInt32LE(0x3c);
    valid =
      offset + 6 <= data.length &&
      data.readUInt32LE(offset) === 0x00004550 &&
      data.readUInt16LE(offset + 4) === (arm ? 0xaa64 : 0x8664);
  } else if (target.os === "linux" && data.length >= 20) {
    valid =
      data.subarray(0, 4).toString("hex") === "7f454c46" &&
      data[4] === 2 &&
      data[5] === 1 &&
      data.readUInt16LE(18) === (arm ? 183 : 62);
  } else if (target.os === "macos" && data.length >= 8) {
    valid =
      data.readUInt32LE(0) === 0xfeedfacf &&
      data.readUInt32LE(4) === (arm ? 0x0100000c : 0x01000007);
  }
  if (!valid) throw new Error(`binary platform/architecture mismatch: ${target.os}/${target.arch}`);
}
