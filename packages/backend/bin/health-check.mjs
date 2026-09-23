#!/usr/bin/env node
// P1 backend entry: one-shot handshake line for the guardian's health probe.
// P2 turns the backend into a long-lived supervised service; this entry only
// proves guardian -> backend spawn/stdio works on the bundled Node binary.
//
// protocol_version MUST equal PROTOCOL_VERSION in @xresconv/contracts; the
// consistency assertion lives in packages/backend/test/health-check.test.mjs
// (this plain-JS entry cannot import the TypeScript contract source).
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    role: "backend",
    pid: process.pid,
    node: process.version,
    protocol_version: 1,
  })}\n`,
);
