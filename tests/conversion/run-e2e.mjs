#!/usr/bin/env node
/**
 * P3-10 G3 差分证据：新栈（tokenize → encodeTaskLine → runJavaBatch stdin）vs
 * 基线（同一 argv 逐条直接 spawn java，不经 stdin），逐文件 SHA-256 对比。
 *
 * 任务选自 sample/gen_sample_output.ps1 的 $TASK_LINES（$proto_dir→输出目录、
 * $XLSX_FILE→资源转换示例.xlsx），覆盖 lua/json/bin/xml/msgpack/js/ue-json/ue-csv 八种
 * 输出类型、-s/-m 直给与 -m k=v 两种形态、-n 正则重命名、--pretty/--validator-rules
 * 等 flag 与 UeCfg-CodeOutput C++ 代码树生成。
 *
 * 归一化规则（C15 口径，窄范围、不掩盖业务差异）：UnreaImportSettings.json 是
 * xresloader 生成的 UE 导入辅助清单，其 Filenames 嵌入输出根目录的绝对路径
 * （已实测：同 JAR 同参数仅 -o 不同即产生此唯一差异）。两路径输出根必然不同，
 * 因此仅对该文件把自身输出根的绝对路径替换为 `{OUT}` 后再比对；其余所有文件
 * （含 ArrInArrCfg.json 等业务产物）按字节 SHA-256 严格比对。
 *
 * 退出码：0=全部 MATCH；1=存在差异或任务失败；2=jar/sample 缺失（不伪造通过）；3=总超时 600s。
 * 差异证据：status!=MATCH 时把差异文件复制到 build/g3-e2e/diff-evidence/{A,B}/ 再清理临时目录。
 *
 * 用法：node tests/conversion/run-e2e.mjs
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
  // ue-json/ue-csv 输出到 {OUT} 子目录并额外生成 C++ 代码树（Public/Private/ConfigRec
  // 与 UnreaImportSettings.json），hashTree 递归自动覆盖。
  {
    name: "ue-json-datasource-codeoutput",
    source: "gen_sample_output.ps1:59",
    line: `-t ue-json -o '{OUT}/json' -f proto_v2/kind.pb --validator-rules custom_validator.yaml -m 'DataSource=${XLSX}|arr_in_arr|3,1' -m 'MacroSource=${XLSX}|macro|2,1' -m ProtoName=arr_in_arr_cfg -m OutputFile=ArrInArrCfg.json -m KeyRow=2 -m UeCfg-CodeOutput=|Public/ConfigRec|Private/ConfigRec --data-source-mapping-mode sha256 --data-source-mapping-file proto_v2/data_source_mapping.txt -a 1.0.0.0`,
  },
  {
    name: "ue-csv-datasource-codeoutput",
    source: "gen_sample_output.ps1:61",
    line: `-t ue-csv -o '{OUT}/csv' -f proto_v2/kind.pb --validator-rules custom_validator.yaml -m 'DataSource=${XLSX}|arr_in_arr|3,1' -m 'MacroSource=${XLSX}|macro|2,1' -m ProtoName=arr_in_arr_cfg -m OutputFile=ArrInArrCfgRec.csv -m KeyRow=2 -m UeCfg-CodeOutput=|Public/ConfigRec|Private/ConfigRec -m UeCfg-EnableDefaultLoader=false --data-source-mapping-mode sha256 --data-source-mapping-file proto_v2/data_source_mapping.txt -a 1.0.0.0`,
  },
];

const execFileAsync = promisify(execFile);

function sha256File(file, normalize) {
  let content = readFileSync(file);
  if (normalize) {
    content = normalize(content);
  }
  return createHash("sha256").update(content).digest("hex");
}

// 仅为 UnreaImportSettings.json 归一化输出根绝对路径（JSON 文本中反斜杠成对出现，
// 同时覆盖正斜杠形态）；其余文件不触碰。
function makeManifestNormalizer(outRoot) {
  const abs = path.resolve(outRoot);
  const variants = [abs.replaceAll("\\", "\\\\"), abs.replaceAll("\\", "/")];
  return (relPath, content) => {
    if (!/(^|[\\/])UnreaImportSettings\.json$/.test(relPath)) {
      return content;
    }
    let text = content.toString("utf8");
    for (const variant of variants) {
      text = text.replaceAll(variant, "{OUT}");
    }
    return Buffer.from(text, "utf8");
  };
}

function hashTree(dir, base, normalize) {
  const out = {};
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      Object.assign(out, hashTree(full, base, normalize));
    } else {
      const rel = path.relative(base, full);
      out[rel] = sha256File(full, normalize && ((buf) => normalize(rel, buf)));
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

  const diffFiles = [];
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

    const treeA = hashTree(outA, outA, makeManifestNormalizer(outA));
    const treeB = hashTree(outB, outB, makeManifestNormalizer(outB));
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
    diffFiles.push(...diffs.map((d) => d.file));

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
    if (diffFiles.length > 0) {
      const evidenceDir = path.join(REPORT_DIR, "diff-evidence");
      for (const rel of diffFiles) {
        for (const [tag, root] of [["A", outA], ["B", outB]]) {
          const src = path.join(root, rel);
          if (existsSync(src)) {
            const dst = path.join(evidenceDir, tag, rel);
            mkdirSync(path.dirname(dst), { recursive: true });
            copyFileSync(src, dst);
          }
        }
      }
      console.error(`[G3-E2E] diff evidence saved under ${evidenceDir}`);
    }
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
