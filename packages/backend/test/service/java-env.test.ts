import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { checkJavaEnvironment } from "../../src/service/java-env.ts";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  terminate: vi.fn(async () => ({})),
  dispose: vi.fn(async () => {}),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("@xresconv/guardian", () => ({
  resolveJavaExecutable: () => ({ command: "java", source: "path" }),
  createProcessScope: () => ({
    decorateSpawnOptions: (options: unknown) => options,
    register: vi.fn(),
    terminate: mocks.terminate,
    dispose: mocks.dispose,
  }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function javaOutput(text: string, code = 0, close = true) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  mocks.spawn.mockImplementation(() => {
    queueMicrotask(() => {
      child.stderr.write(text);
      if (close) child.emit("close", code);
    });
    return child;
  });
  return child;
}

it("parses the Java version line independently of numeric environment warnings", async () => {
  javaOutput(
    'Picked up JAVA_TOOL_OPTIONS: -Xmx2048m\nopenjdk version "1.7.0_80"\n64-Bit Server VM',
  );
  expect(await checkJavaEnvironment()).toMatchObject({ ok: false, versions: [1, 7, 0, 80] });
});
it("accepts an integral release number", async () => {
  javaOutput('openjdk version "25" 2025-09-16\nOpenJDK 64-Bit Server VM');
  expect(await checkJavaEnvironment()).toMatchObject({ ok: true, versions: [25] });
});
it("does not report a nonzero process exit as healthy", async () => {
  javaOutput('openjdk version "24.0.1"\n64-Bit Server VM', 1);
  expect(await checkJavaEnvironment()).toMatchObject({
    ok: false,
    problem: expect.stringMatching(/1/),
  });
});
it("terminates the probe process tree at the deadline", async () => {
  vi.useFakeTimers();
  javaOutput("", 0, false);
  const result = checkJavaEnvironment();
  await vi.advanceTimersByTimeAsync(8000);
  expect(await result).toMatchObject({ ok: false, problem: expect.stringMatching(/超时/) });
  expect(mocks.terminate).toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalled();
});
