import { encodeFrame } from "@xresconv/ipc";

process.stdout.write(
  encodeFrame({
    protocol_version: 1,
    kind: "health",
    id: "wrong-role",
    role: "backend",
    payload: {},
  }),
);
process.stdin.resume();
setTimeout(() => process.exit(0), 5000);
