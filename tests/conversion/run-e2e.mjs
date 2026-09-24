#!/usr/bin/env node
/**
 * P3-10 G3 差分证据：新栈（tokenize → encodeTaskLine → runJavaBatch stdin）vs
 * 基线（同一 argv 逐条直接 spawn java，不经 stdin），逐文件 SHA-256 对比。
 *
 * 任务选自 sample/gen_sample_output.ps1 的 $TASK_LINES（$proto_dir→输出目录、
 * $XLSX_FILE→资源转换示例.xlsx），覆盖 lua/json/bin/xml/msgpack/js 六种输出类型、
 * -s/-m 直给与 -m k=v 两种形态、-n 正则重命名与 --pretty/--validator-rules 等 flag。
 *
 * 退出码：0=全部 MATCH；1=存在差异或任务失败；2=jar/sample 缺失（不伪造通过）；3=总超时 600s。
 *
 * 用法：node tests/conversion/run-e2e.mjs
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildArgvFallbackCommand, encodeTaskLine, tokenizeStdinLine } from "@xresconv/backend";
import { runJavaBatch, runWithDeadline } from "@xresconv/guardian";

const JAR = "D:/workspace/github/xresloader/xresloader/target/xresloader-2.23.7.jar";
const SAMPLE_DIR = "D:/workspace/github/xresloader/xresloader/sample";
const XLSX = "资源转换示例.xlsx";
const JAVA_ARGS = ["-Dfile.encoding=UTF-8"];
const PER_PROCESS_DEADLINE_MS = 180_000;
const TOTAL_TIMEOUT_MS = 600_000;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPORT_DIR = path.join(REPO_ROOT, "build", "g3-e2e");
const REPORT_PATH = path.join(REPORT_DIR, "report.json");

// 选自 gen_sample_output.ps1 $TASK_LINES（行号为该文件行号）；{OUT} 替换为各路径输出目录。
// 两处适配（均不改变被测语义）：
// - 每条追加 `-a 1.0.0.0`：缺省数据版本带秒级时间戳（data_ver=2.23.7.<yyyyMMddHHmmss>，
//   实测跨进程差 1 秒即 hash 不同），ps1:86 官方做法即全局 `--data-version 1.0.0.0`。
// - js 任务用 ps1:42（-s/-m scheme_kind + amd export）而非 ps1:41（DataSource|role，
//   实测 sheet "role" 不存在、官方样例此线亦失败）；-m k=v 形态由 xml/bin 两条覆盖。
const TASKS = [
  {
    name: "lua-const-print",
    source: "gen_sample_output.ps1:35",
    line: `-t lua -p protobuf -o '{OUT}' -f proto_v2/kind.pb --pretty 2 -i kind.desc.lua --data-source-mapping-mode sha256 --data-source-mapping-file proto_v2/data_source_mapping.txt -a 1.0.0.0`,
  },
  {
    name: "json-descriptor-print",
    source: "gen_sample_output.ps1:36",
    line: `-t json -p protobuf -o '{OUT}' -f proto_v2/kind.pb --pretty 2 -r kind.desc.json --data-source-mapping-mode sha256 --data-source-mapping-file proto_v2/data_source_mapping.txt -a 1.0.0.0`,
  },
  {
    name: "msgpack-src-scheme-rename",
    source: "gen_sample_output.ps1:39",
    line: `-t msgpack -p protobuf -o '{OUT}' -f proto_v2/kind.pb -s '${XLSX}' -m scheme_kind -n '/(?i)\\.bin$/\\.msgpack.bin/' --data-source-mapping-mode sha256 --data-source-mapping-file proto_v2/data_source_mapping.txt -a 1.0.0.0`,
  },
  {
    name: "xml-datasource-kv",
    source: "gen_sample_output.ps1:45",
    line: `-t xml -p protobuf -o '{OUT}' -f proto_v2/kind.pb --pretty 2 --validator-rules custom_validator.yaml -m 'DataSource=${XLSX}|arr_in_arr|3,1' -m 'MacroSource=${XLSX}|macro|2,1' -m ProtoName=arr_in_arr_cfg -m OutputFile=arr_in_arr_cfg.xml -m KeyRow=2 --data-source-mapping-mode sha256 --data-source-mapping-file proto_v2/data_source_mapping.txt -a 1.0.0.0`,
  },
  {
    name: "bin-datasource-kv",
    source: "gen_sample_output.ps1:44",
    line: `-t bin -p protobuf -o '{OUT}' -f proto_v2/kind.pb --validator-rules custom_validator.yaml -m 'DataSource=${XLSX}|arr_in_arr|3,1' -m 'MacroSource=${XLSX}|macro|2,1' -m ProtoName=arr_in_arr_cfg -m OutputFile=arr_in_arr_cfg.bin -m KeyRow=2 --data-source-mapping-mode sha256 --data-source-mapping-file proto_v2/data_source_mapping.txt -a 1.0.0.0`,
  },
  {
    name: "js-src-scheme-amd",
    source: "gen_sample_output.ps1:42",
    line: `-t js -p protobuf -o '{OUT}' -f proto_v2/kind.pb --pretty 2 -s '${XLSX}' -m scheme_kind -n '/(?i)\\.bin$/\\.amd\\.js/' --javascript-export amd --data-source-mapping-mode sha256 --data-source-mapping-file proto_v2/data_source_mapping.txt -a 1.0.0.0`,
  },
];

const execFileAsync = promisify(execFile);

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function hashTree(dir, base = dir) {
  const out = {};
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      Object.assign(out, hashTree(full, base));
    } else {
      out[path.relative(base, full)] = sha256File(full);
    }
  }
  return out;
}

async function javaVersion() {
  try {
    const { stderr } = await execFileAsync("java", ["-version"]);
    return stderr.trim().split("\n")[0] ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function main() {
  for (const required of [JAR, SAMPLE_DIR, path.join(SAMPLE_DIR, "proto_v2/kind.pb"), path.join(SAMPLE_DIR, XLSX)]) {
    if (!existsSync(required)) {
      console.error(`[G3-E2E] required artifact missing: ${required}`);
      process.exit(2);
    }
  }

  const startedAt = new Date().toISOString();
  const outA = mkdtempSync(path.join(tmpdir(), "xresconv-g3-A-"));
  const outB = mkdtempSync(path.join(tmpdir(), "xresconv-g3-B-"));
  const report = {
    startedAt,
    jar: JAR,
    jarSha256: sha256File(JAR),
    javaVersion: await javaVersion(),
    sampleDir: SAMPLE_DIR,
    tasks: [],
    summary: {},
  };

  try {
    // 路径 A（新栈）：ps1 行 → tokenizeStdinLine（Main.java tokenizer 同形移植）→
    // encodeTaskLine → runJavaBatch 单进程 stdin 批次。
    const encoded = TASKS.map((task) => {
      const argv = tokenizeStdinLine(task.line.replaceAll("{OUT}", outA));
      return { task, argv, line: encodeTaskLine(argv) };
    });
    const logsA = [];
    const resultA = await runJavaBatch({
      javaArgs: JAVA_ARGS,
      jarPath: JAR,
      workDir: SAMPLE_DIR,
      tasks: encoded.map((e) => e.line),
      onLog: (stream, text) => logsA.push({ stream, text }),
      deadlineMs: PER_PROCESS_DEADLINE_MS,
    });

    // 路径 B（基线）：同一批任务逐条直接 spawn java argv（buildArgvFallbackCommand，不经 stdin）。
    const resultsB = [];
    for (const task of TASKS) {
      const argv = tokenizeStdinLine(task.line.replaceAll("{OUT}", outB));
      const res = await runWithDeadline("java", {
        args: buildArgvFallbackCommand(JAVA_ARGS, JAR, argv),
        cwd: SAMPLE_DIR,
        deadlineMs: PER_PROCESS_DEADLINE_MS,
      });
      resultsB.push({ task, argv, exitCode: res.exitCode });
    }

    const treeA = hashTree(outA);
    const treeB = hashTree(outB);
    const allFiles = [...new Set([...Object.keys(treeA), ...Object.keys(treeB)])].sort();
    const diffs = [];
    for (const file of allFiles) {
      if (!(file in treeA)) {
        diffs.push({ file, issue: "missing-in-A", hashB: treeB[file] });
      } else if (!(file in treeB)) {
        diffs.push({ file, issue: "missing-in-B", hashA: treeA[file] });
      } else if (treeA[file] !== treeB[file]) {
        diffs.push({ file, issue: "hash-mismatch", hashA: treeA[file], hashB: treeB[file] });
      }
    }

    for (let i = 0; i < TASKS.length; i++) {
      report.tasks.push({
        name: TASKS[i].name,
        source: TASKS[i].source,
        encodedLineA: encoded[i].line,
        exitCodeB: resultsB[i].exitCode,
      });
    }
    report.summary = {
      taskCount: TASKS.length,
      exitCodeA: resultA.exitCode,
      failedTaskCountA: resultA.failedTaskCount,
      durationMsA: resultA.durationMs,
      baselineFailuresB: resultsB.filter((r) => r.exitCode !== 0).length,
      fileCountA: Object.keys(treeA).length,
      fileCountB: Object.keys(treeB).length,
      files: Object.fromEntries(
        allFiles.map((f) => [f, diffs.some((d) => d.file === f) ? "DIFF" : "MATCH"]),
      ),
      diffs,
      status:
        diffs.length === 0 && resultA.exitCode === 0 && resultsB.every((r) => r.exitCode === 0)
          ? "MATCH"
          : "DIFF",
    };

    mkdirSync(REPORT_DIR, { recursive: true });
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

    console.log(`[G3-E2E] report: ${REPORT_PATH}`);
    console.log(
      `[G3-E2E] tasks=${TASKS.length} filesA=${report.summary.fileCountA} filesB=${report.summary.fileCountB} exitA=${resultA.exitCode} baselineFailuresB=${report.summary.baselineFailuresB}`,
    );
    for (const file of allFiles) {
      const state = report.summary.files[file];
      console.log(`  ${state} ${file}`);
      const diff = diffs.find((d) => d.file === file);
      if (diff) {
        console.log(`    A=${diff.hashA ?? "<missing>"} B=${diff.hashB ?? "<missing>"} (${diff.issue})`);
      }
    }
    if (report.summary.status !== "MATCH") {
      console.error("[G3-E2E] DIFF detected");
      process.exit(1);
    }
    console.log("[G3-E2E] all MATCH");
    process.exit(0);
  } finally {
    rmSync(outA, { recursive: true, force: true });
    rmSync(outB, { recursive: true, force: true });
  }
}

const totalTimer = setTimeout(() => {
  console.error(`[G3-E2E] total timeout ${TOTAL_TIMEOUT_MS}ms exceeded`);
  process.exit(3);
}, TOTAL_TIMEOUT_MS);

main().catch((err) => {
  clearTimeout(totalTimer);
  console.error(`[G3-E2E] failed:`, err);
  process.exit(1);
});
