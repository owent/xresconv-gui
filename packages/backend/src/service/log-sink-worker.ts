/** Isolated log4js extension host. stdout is reserved for framed replies. */
import { Writable } from "node:stream";
import { FrameDecoder, writeFrame } from "@xresconv/ipc";

const controlWrite = process.stdout.write.bind(process.stdout);
const control = new Writable({
  write(chunk, _encoding, done) {
    controlWrite(chunk, done);
  },
});
process.stdout.write = process.stderr.write.bind(process.stderr);
const { default: log4js } = await import("log4js");
let configured = false;
const levels = { info: "info", notice: "info", warning: "warn", error: "error" } as const;

async function handle(value: unknown): Promise<void> {
  const request = value as { id: string; kind: string; payload: Record<string, unknown> };
  let error: string | undefined;
  let diagnostic: string | undefined;
  try {
    if (request.kind === "init") {
      try {
        log4js.configure(request.payload.config as Parameters<typeof log4js.configure>[0]);
      } catch (err) {
        diagnostic = `log4js configuration failed: ${String(err)}`;
        error = diagnostic;
      }
      configured = error === undefined;
    } else if (request.kind === "append" && configured) {
      const { level, moduleName, text } = request.payload;
      if (
        typeof level !== "string" ||
        !Object.hasOwn(levels, level) ||
        typeof text !== "string" ||
        typeof moduleName !== "string"
      )
        throw new Error("invalid log record");
      log4js.getLogger(moduleName || undefined)[levels[level as keyof typeof levels]](text);
    } else if (request.kind === "shutdown") {
      await new Promise<void>((resolve, reject) =>
        log4js.shutdown((err) => (err ? reject(err) : resolve())),
      );
    } else throw new Error("unexpected log worker command");
  } catch (err) {
    error = String(err);
  }
  await writeFrame(control, { id: request.id, error, diagnostic });
  if (request.kind === "shutdown") process.exit(error ? 1 : 0);
}

const decoder = new FrameDecoder(
  (value) => {
    void handle(value).catch(() => process.exit(1));
  },
  () => process.exit(1),
);
process.stdin.on("data", (chunk: Buffer) => decoder.push(chunk));
process.stdin.once("end", () => process.exit(0));
