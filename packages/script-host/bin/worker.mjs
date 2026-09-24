#!/usr/bin/env node
// fd1 is the framed IPC channel (@xresconv/ipc). Redirect every console method
// to fd2 BEFORE loading the worker so stray console.* calls in this process can
// never corrupt outbound frames. User scripts do NOT get console injected at
// all (legacy parity, P0-08 §2); this guard covers worker-internal code only.
import { Console } from "node:console";

globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });

// Node 24 type stripping runs worker-main.ts (and its transitive .ts imports)
// directly; everything reachable from here MUST be erasable-syntax-only TS.
await import("../src/worker-main.ts");
