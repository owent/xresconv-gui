import { FrameDecoder, writeFrame } from "@xresconv/ipc";

// Acknowledge entry before blocking so the parent controls cancellation/death ordering.
const decoder = new FrameDecoder(
  (request) => {
    if (request.rule === "hold") {
      process.stderr.write("MATCH_STARTED\n", () => {
        for (;;) {}
      });
    } else {
      void writeFrame(process.stdout, {
        type: "result",
        id: request.id,
        results: request.inputs.map((input) => input === request.rule),
      });
    }
  },
  (error) => {
    throw error;
  },
);
process.stdin.on("data", (chunk) => decoder.push(chunk));
process.stdin.once("end", () => process.exit(0));
void writeFrame(process.stdout, { type: "ready", pid: process.pid });
