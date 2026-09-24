import { PROTOCOL_VERSION } from "@xresconv/contracts";

setTimeout(() => {
  process.send?.({
    protocol_version: PROTOCOL_VERSION,
    role: "backend",
    kind: "health",
    id: "ready",
    payload: process.env.REVIEW_BAD_HEALTH === "1" ? null : { ok: true, pid: process.pid },
  });
}, 150);
process.on("message", (env) => {
  if (env.kind === "shutdown") process.exit(0);
});
setInterval(() => {}, 1000);
