/**
 * Guardian: 进程树监督（P2-02，SC07/SC08/SC11）。
 *
 * 目标（docs/plan/02-contracts-script-host.md「监督进程与清理」）：
 * - 终止必须覆盖整棵进程树，且以 close 事件为实际回收证据；`kill()` 返回值
 *   或 taskkill 退出码不单独构成清理证明。
 * - 登记原生进程句柄防止 PID 重用误杀（Windows：持有 OpenProcess 句柄期间
 *   内核不会重用该 PID）。
 * - guardian 崩溃时所属子树仍被回收（Windows：JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE，
 *   最后一个 job 句柄被 OS 关闭时内核终止全部关联进程）。
 *
 * 后端选择（Windows）：
 * 1. job-object：经 koffi（MIT，Node-API 预编译）调用 CreateJobObjectW /
 *    AssignProcessToJobObject / TerminateJobObject。子进程默认自动加入 job，
 *    覆盖孙进程；guardian 崩溃由内核兜底。
 * 2. taskkill（koffi 加载/初始化失败时降级）：`taskkill /PID <pid> /T /F`。
 *    已知边界：中间进程先退出时孙进程断链成孤儿（微软 /T 只追踪仍存续的
 *    父子链），guardian 崩溃场景无人执行 taskkill。降级会被显式记录。
 * POSIX：spawn 时 detached:true 使子进程成为新进程组组长，终止用
 * kill(-pgid, SIGTERM/SIGKILL) 覆盖组内后代。setsid/double-fork 逃逸不设防
 * （D4 可信脚本）；guardian 崩溃后的 POSIX 清理依赖壳层生命周期适配（待 P5）。
 */

import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { createRequire } from "node:module";

export type ProcessTreeBackend = "job-object" | "taskkill" | "process-group";

export interface TreeTerminateReport {
  readonly backend: ProcessTreeBackend;
  /** close 事件确认的 pid。 */
  readonly reapedPids: number[];
  /** 终止后未在预算内确认 close 的 pid（清理未确认，调用方必须上报）。 */
  readonly unreapedPids: number[];
}

export interface ProcessScope {
  readonly name: string;
  readonly backend: ProcessTreeBackend;
  /** POSIX 注入 detached:true；Windows 原样返回。spawn 前调用。 */
  decorateSpawnOptions<T extends SpawnOptions>(options: T): T;
  /** 登记子进程所有权；spawn 成功后立即调用。 */
  register(child: ChildProcess): void;
  /**
   * 终止整树并等待实际回收。幂等；重复调用复用首次结果。
   * Windows job-object：TerminateJobObject 一次终止全部关联进程。
   * Windows taskkill 回退：对每个仍存活根进程执行 taskkill /T /F。
   * POSIX：先 kill(-pgid, SIGTERM)，graceMs 后对未退出组 kill(-pgid, SIGKILL)。
   */
  terminate(graceMs?: number): Promise<TreeTerminateReport>;
  /** 释放句柄；仅在没有存活成员时安全（有存活成员会先 terminate）。 */
  dispose(): Promise<void>;
}

/** koffi 使用子集的最小类型声明（避免依赖其 d.ts 解析细节）。 */
interface KoffiLike {
  load(library: string): {
    func(signature: string): (...args: unknown[]) => unknown;
  };
}

const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
/** JOBOBJECT_EXTENDED_LIMIT_INFORMATION 在 x64/arm64 的大小；LimitFlags 偏移 16。 */
const JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE = 144;
const JOBOBJECT_LIMIT_FLAGS_OFFSET = 16;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const OPEN_PROCESS_ACCESS =
  PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION;

/** terminate 后等待 close 的额外预算（各后端共用）。 */
const REAP_BUDGET_MS = 2000;
/** taskkill 单次调用自身的等待预算。 */
const TASKKILL_BUDGET_MS = 5000;

interface RegisteredChild {
  readonly child: ChildProcess;
  readonly pid: number;
  /** Windows: 常驻 OpenProcess 句柄（防 PID 重用）；关闭时置 null。 */
  handle: unknown;
  closed: boolean;
}

interface Win32JobApi {
  createJob(): unknown;
  setKillOnJobClose(job: unknown): boolean;
  openProcess(pid: number): unknown;
  assign(job: unknown, processHandle: unknown): boolean;
  terminateJob(job: unknown, exitCode: number): boolean;
  closeHandle(handle: unknown): void;
}

let cachedKoffi: KoffiLike | null | undefined;
function loadKoffi(): KoffiLike | null {
  if (cachedKoffi !== undefined) {
    return cachedKoffi;
  }
  try {
    const require = createRequire(import.meta.url);
    cachedKoffi = require("koffi") as KoffiLike;
  } catch {
    cachedKoffi = null;
  }
  return cachedKoffi;
}

function loadWin32JobApi(): Win32JobApi | null {
  const koffi = loadKoffi();
  if (koffi === null) {
    return null;
  }
  try {
    const kernel32 = koffi.load("kernel32.dll");
    const createJobObject = kernel32.func(
      "void* CreateJobObjectW(void* lpJobAttributes, const char16_t* lpName)",
    );
    const setInformationJobObject = kernel32.func(
      "bool SetInformationJobObject(void* hJob, int jobObjectInformationClass, void* lpJobObjectInformation, uint32 cbJobObjectInformationLength)",
    );
    const openProcess = kernel32.func(
      "void* OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)",
    );
    const assignProcessToJobObject = kernel32.func(
      "bool AssignProcessToJobObject(void* hJob, void* hProcess)",
    );
    const terminateJobObject = kernel32.func(
      "bool TerminateJobObject(void* hJob, uint32 uExitCode)",
    );
    const closeHandle = kernel32.func("bool CloseHandle(void* hObject)");
    return {
      createJob: () => createJobObject(null, null),
      setKillOnJobClose: (job) => {
        const info = new ArrayBuffer(JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE);
        new DataView(info).setUint32(
          JOBOBJECT_LIMIT_FLAGS_OFFSET,
          JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
          true,
        );
        return setInformationJobObject(
          job,
          JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
          info,
          JOBOBJECT_EXTENDED_LIMIT_INFORMATION_SIZE,
        ) as boolean;
      },
      openProcess: (pid) => openProcess(OPEN_PROCESS_ACCESS, false, pid),
      assign: (job, processHandle) => assignProcessToJobObject(job, processHandle) as boolean,
      terminateJob: (job, exitCode) => terminateJobObject(job, exitCode) as boolean,
      closeHandle: (handle) => {
        closeHandle(handle);
      },
    };
  } catch {
    return null;
  }
}

function waitForClose(entry: RegisteredChild, budgetMs: number): Promise<boolean> {
  if (entry.closed) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      entry.child.off("close", onClose);
      resolve(entry.closed);
    }, budgetMs);
    timer.unref?.();
    const onClose = (): void => {
      clearTimeout(timer);
      resolve(true);
    };
    entry.child.once("close", onClose);
  });
}

async function runTaskkill(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    const timer = setTimeout(finish, TASKKILL_BUDGET_MS);
    timer.unref?.();
    try {
      const taskkill = spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      taskkill.once("error", finish);
      taskkill.once("close", () => {
        clearTimeout(timer);
        finish();
      });
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

class ProcessScopeImpl implements ProcessScope {
  readonly name: string;
  readonly backend: ProcessTreeBackend;
  private readonly children = new Map<number, RegisteredChild>();
  private readonly job: unknown = null;
  private readonly jobApi: Win32JobApi | null = null;
  private terminatePromise: Promise<TreeTerminateReport> | null = null;

  constructor(name: string, forcedBackend?: ProcessTreeBackend) {
    this.name = name;
    if (process.platform === "win32") {
      if (forcedBackend !== "taskkill") {
        this.jobApi = loadWin32JobApi();
        if (this.jobApi !== null) {
          const job = this.jobApi.createJob();
          if (job !== null && this.jobApi.setKillOnJobClose(job)) {
            this.job = job;
          } else if (job !== null) {
            this.jobApi.closeHandle(job);
          }
        }
      }
      this.backend = this.job !== null ? "job-object" : "taskkill";
    } else {
      this.backend = "process-group";
    }
  }

  decorateSpawnOptions<T extends SpawnOptions>(options: T): T {
    if (this.backend === "process-group") {
      return { ...options, detached: true };
    }
    return { ...options };
  }

  register(child: ChildProcess): void {
    const pid = child.pid;
    if (pid === undefined) {
      return;
    }
    let handle: unknown = null;
    if (this.jobApi !== null) {
      handle = this.jobApi.openProcess(pid);
      if (handle !== null && this.job !== null) {
        // 子进程可能在 register 前已退出；失败分配无害（进程已终结）。
        this.jobApi.assign(this.job, handle);
      }
    }
    const entry: RegisteredChild = { child, pid, handle, closed: false };
    this.children.set(pid, entry);
    child.once("close", () => {
      entry.closed = true;
      if (entry.handle !== null && this.jobApi !== null) {
        this.jobApi.closeHandle(entry.handle);
        entry.handle = null;
      }
    });
    // 终止已经开始后才登记的进程：立即补杀，不放生。
    if (this.terminatePromise !== null) {
      void this.terminate(0);
    }
  }

  terminate(graceMs = 0): Promise<TreeTerminateReport> {
    this.terminatePromise ??= this.doTerminate(graceMs);
    return this.terminatePromise;
  }

  async dispose(): Promise<void> {
    if ([...this.children.values()].some((entry) => !entry.closed)) {
      await this.terminate(0);
    }
    if (this.job !== null && this.jobApi !== null) {
      this.jobApi.closeHandle(this.job);
    }
    for (const entry of this.children.values()) {
      if (entry.handle !== null && this.jobApi !== null) {
        this.jobApi.closeHandle(entry.handle);
        entry.handle = null;
      }
    }
    this.children.clear();
  }

  private async doTerminate(graceMs: number): Promise<TreeTerminateReport> {
    const live = [...this.children.values()].filter((entry) => !entry.closed);
    if (this.backend === "job-object" && this.job !== null && this.jobApi !== null) {
      if (live.length > 0) {
        this.jobApi.terminateJob(this.job, 1);
      }
    } else if (this.backend === "taskkill") {
      await Promise.all(live.map((entry) => runTaskkill(entry.pid)));
    } else {
      // POSIX：组级 SIGTERM → 宽限 → 组级 SIGKILL；ESRCH 表示组已消亡，忽略。
      for (const entry of live) {
        try {
          process.kill(-entry.pid, "SIGTERM");
        } catch {
          // 组已退出。
        }
      }
      if (graceMs > 0) {
        await Promise.all(live.map((entry) => waitForClose(entry, graceMs)));
      }
      for (const entry of live) {
        if (entry.closed) {
          continue;
        }
        try {
          process.kill(-entry.pid, "SIGKILL");
        } catch {
          // 组已退出。
        }
      }
    }
    const results = await Promise.all(live.map((entry) => waitForClose(entry, REAP_BUDGET_MS)));
    return {
      backend: this.backend,
      reapedPids: live.filter((_, index) => results[index]).map((entry) => entry.pid),
      unreapedPids: live.filter((_, index) => !results[index]).map((entry) => entry.pid),
    };
  }
}

export interface ProcessScopeOptions {
  readonly name?: string;
  /** 测试用：强制后端（当前仅支持 win32 强制 "taskkill" 以覆盖回退路径）。 */
  readonly forceBackend?: ProcessTreeBackend;
}

export function createProcessScope(options: ProcessScopeOptions = {}): ProcessScope {
  return new ProcessScopeImpl(options.name ?? "scope", options.forceBackend);
}

/** 诊断：当前平台实际会选用的后端（不创建 scope）。 */
export function expectedProcessTreeBackend(): ProcessTreeBackend {
  if (process.platform === "win32") {
    return loadWin32JobApi() !== null ? "job-object" : "taskkill";
  }
  return "process-group";
}
