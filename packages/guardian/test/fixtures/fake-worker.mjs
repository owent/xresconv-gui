// Fake script worker for P2-01 test g: completes a VALID health handshake,
// then emits a frame whose JSON is not a valid envelope. The guardian pool
// must discard this worker (fault, no replenish) without crashing.
import { Buffer } from "node:buffer";

function frame(value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  return Buffer.concat([head, body]);
}

process.stdout.write(
  frame({
    protocol_version: 1,
    kind: "health",
    id: "fake-worker-health",
    role: "script-worker",
    payload: { ok: true, pid: process.pid, node: process.version },
  }),
);

const poison = setTimeout(() => {
  process.stdout.write(frame({ bogus: true }));
}, 20);
poison.unref();

// Stay alive until the guardian kills us; self-exit as a last resort. This
// timer MUST stay ref'd: with every handle unref'd the process exits before
// the poison frame above ever fires.
setTimeout(() => process.exit(0), 5000);
