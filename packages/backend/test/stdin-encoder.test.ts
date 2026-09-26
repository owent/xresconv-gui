/**
 * stdin 编码器测试（P3-06）。
 *
 * 断言基准：测试内置一个 Main.java stdin tokenizer 的同形 JS mini-parser
 * （来源：xresloader/src/org/xresloader/core/Main.java:344-374——
 * 模式 `('[^']*')|("[^"]*")|(\S+)`（Main.java:344-345）、单/双引号成对剥除
 * （Main.java:357-361）、空 token 丢弃（Main.java:363-365）），
 * 断言 encodeTaskLine 输出经 mini-parser 还原 === 原 argv。
 */
import { describe, expect, it } from "vitest";
import {
  buildArgvFallbackCommand,
  encodeTaskLine,
  StdinEncodeError,
  tokenizeStdinLine,
} from "../src/convert/stdin-encoder.ts";

/** Main.java:344-374 同形 mini-parser（断言基准，勿与 src 实现共享代码）。 */
function miniParseStdinLine(line: string): string[] {
  const pattern = /'[^']*'|"[^"]*"|\S+/g;
  const tokens: string[] = [];
  for (const match of line.matchAll(pattern)) {
    let token = match[0];
    const first = token.charAt(0);
    const last = token.charAt(token.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      token = token.length > 2 ? token.slice(1, -1) : "";
    }
    if (token.length > 0) {
      tokens.push(token);
    }
  }
  return tokens;
}

describe("encodeTaskLine: mini-parser 往返（Main.java:344-374 基准）", () => {
  const cases: Array<[string, string[]]> = [
    ["简单 flag 与值", ["-t", "lua", "-p", "protobuf", "--pretty", "2"]],
    ["中文值", ["-o", "输出 目录/结果", "-m", "ProtoName=资源转换示例"]],
    ["含空格值", ["-m", "KeyWordRegex=[A-Z_$ ]|[_$ ]|[a-zA-Z_$]"]],
    ["含单引号值", ["-m", "Name=it's fine"]],
    ["含双引号值", ["-n", 'say "hi"']],
    ["反斜杠 Windows 路径", ["-o", "C:\\work\\输出 dir", "-d", "D:\\data\\src"]],
    ["UNC 路径", ["-f", "\\\\server\\share\\proto\\kind.pb"]],
    ["$ 字符正则值", ["-n", "/(?i)\\.bin$/\\.json/"]],
    ["(?i) 内联正则值", ["-m", "KeyWordRegex=(?i)[a-z_\\$]+"]],
    ["点号/冒号/等号混合", ["-m", "DataSource=file.xlsx|sheet1|3,1", "--data-version", "1.0.0.0"]],
    ["tab 空白值", ["-m", "sep=a\tb"]],
  ];

  for (const [name, argv] of cases) {
    it(name, () => {
      const line = encodeTaskLine(argv);
      expect(line).not.toMatch(/[\r\n]/);
      expect(miniParseStdinLine(line)).toEqual(argv);
    });
  }

  it("完整样本任务行（对齐 sample/gen_sample_output.ps1 $TASK_LINES 形态）", () => {
    const argv = [
      "-t",
      "lua",
      "-p",
      "protobuf",
      "-o",
      "output 目录",
      "-f",
      "proto_v2/kind.pb",
      "--pretty",
      "2",
      "-m",
      "DataSource=资源转换示例.xlsx|arr_in_arr|3,1",
      "-m",
      "KeyWordRegex=[A-Z_$ \t]|[_$ ]|[a-zA-Z_$]",
      "-n",
      "/(?i)\\.bin$/\\.lua/",
    ];
    expect(miniParseStdinLine(encodeTaskLine(argv))).toEqual(argv);
  });
});

describe("encodeTaskLine: 不可编码输入抛 StdinEncodeError", () => {
  it("同时含单双引号 → 抛错（tokenizer 无转义机制）", () => {
    expect(() => encodeTaskLine(["-m", `a"b'c`])).toThrowError(StdinEncodeError);
  });

  it("含换行 → 抛错（一行一命令）", () => {
    expect(() => encodeTaskLine(["-o", "a\nb"])).toThrowError(StdinEncodeError);
    expect(() => encodeTaskLine(["-o", "a\rb"])).toThrowError(StdinEncodeError);
  });

  it("空串 token → 抛错（Main.java:363-365 丢弃空 token 会错位 argv）", () => {
    expect(() => encodeTaskLine(["-o", ""])).toThrowError(StdinEncodeError);
  });

  it("错误携带 code/token/reason", () => {
    const err = (() => {
      try {
        encodeTaskLine(["ok", `x"y'z`]);
        return null;
      } catch (e) {
        return e as StdinEncodeError;
      }
    })();
    expect(err).toBeInstanceOf(StdinEncodeError);
    expect(err?.code).toBe("STDIN_ENCODE_ERROR");
    expect(err?.token).toBe(`x"y'z`);
    expect(err?.reason).toContain("single and double quotes");
  });
});

describe("tokenizeStdinLine: Main.java tokenizer 同形移植", () => {
  it("keeps non-ASCII spaces inside bare tokens like Java Pattern without UNICODE_CHARACTER_CLASS", () => {
    expect(tokenizeStdinLine("-o output\u00a0dir\u3000name")).toEqual([
      "-o",
      "output\u00a0dir\u3000name",
    ]);
  });
  it.each(["\u0085", "\u2028", "\u2029"])("rejects Scanner.nextLine separator %j", (separator) => {
    expect(() => encodeTaskLine(["-o", `a${separator}b`])).toThrowError(StdinEncodeError);
  });
  it("引号剥除、多空洞空白、空 token 丢弃", () => {
    expect(tokenizeStdinLine(`-t lua   -o 'my dir' -m "a=b" "" ''`)).toEqual([
      "-t",
      "lua",
      "-o",
      "my dir",
      "-m",
      "a=b",
    ]);
  });

  it("旧式原始片段（global/item option value）切分", () => {
    expect(tokenizeStdinLine(`--pretty 2 -c kind_const.lua`)).toEqual([
      "--pretty",
      "2",
      "-c",
      "kind_const.lua",
    ]);
    expect(tokenizeStdinLine(`-m 'KeyWordRegex=[A-Z_$ ]|[_$ ]'`)).toEqual([
      "-m",
      "KeyWordRegex=[A-Z_$ ]|[_$ ]",
    ]);
  });
});

describe("buildArgvFallbackCommand", () => {
  it("javaArgs + -jar + 任务 argv 直给（不经 stdin）", () => {
    expect(buildArgvFallbackCommand(["-Dfile.encoding=UTF-8"], "x.jar", ["-t", "lua"])).toEqual([
      "-Dfile.encoding=UTF-8",
      "-jar",
      "x.jar",
      "-t",
      "lua",
    ]);
  });
});
