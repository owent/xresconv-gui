// User-script executor entry (P2 implementation target).
//
// Contract (Plan.md §6): this process runs user JavaScript with the legacy
// Node/CommonJS capabilities preserved. It is supervised by the Rust host
// over a private IPC channel; the UI and the Rust scheduler never execute
// user JS. D4: scripts are trusted (fs/child_process allowed); the boundary
// is fault isolation and IPC authorization.
//
// P1 ships only the health-check handshake so the Rust side can already
// prove spawn + IPC + kill in the skeleton phase.

export function healthCheck() {
  return { ok: true, pid: process.pid, node: process.version };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = JSON.stringify(healthCheck());
  process.stdout.write(`${out}\n`);
}
