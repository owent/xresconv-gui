import { writeFrame } from "@xresconv/ipc";
import { ConfigError } from "./check-well-formed.ts";
import { parseXmlConfig } from "./loader.ts";

try {
  const file = process.argv[2];
  if (!file) throw new ConfigError("READ_FAILED", "configuration path is required");
  await writeFrame(process.stdout, { config: await parseXmlConfig(file) });
} catch (error) {
  const failure =
    error instanceof ConfigError ? error : new ConfigError("CONFIG_WORKER_ERROR", String(error));
  await writeFrame(process.stdout, {
    error: { code: failure.code, message: failure.message, details: failure.details },
  });
}
