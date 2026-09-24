//! 壳↔guardian 长驻通道（P4-02）：spawn 长驻 guardian 进程，stdin/stdout
//! 走 @xresconv/ipc 字节帧协议（4 字节大端长度 + UTF-8 JSON，1MiB 上限，
//! 超限预分配前拒绝）。Rust 壳只转发帧，不含业务逻辑（D6）。
//!
//! 契约（与 packages/guardian/bin/service.mjs 对齐）：
//! - 出站 envelope：{protocol_version:1, kind, id, role:"shell", payload}；
//! - 入站：kind "health"（握手/应答）、"rpc_result"（in_reply_to 匹配）、
//!   "event"（reader 线程直接 emit `xresconv-event` 到前端）、"fault"；
//! - guardian EOF/毒帧/死亡 → 通道判死：全部待决请求按错误结算，发
//!   `xresconv-guardian-dead` 事件；壳可显式重启（不自动重放在途请求，SC10）。
//!
//! 分发模型：reader 线程直接 demux——in_reply_to 命中待决表的帧送入对应
//! oneshot；其余帧（事件/无主回复）转前端事件流。请求路径不会吞事件。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use serde_json::{Value, json};

/// 与 packages/ipc/src/index.ts 的 DEFAULT_MAX_FRAME_BYTES 一致。
const MAX_FRAME_BYTES: usize = 1024 * 1024;
/// 握手/健康检查上界：必须覆盖 guardian 启动 + backend fork + 监督握手。
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
/// 单次 RPC 默认上界（loadConfig 等大负载由调用方显式放宽）。
const DEFAULT_RPC_TIMEOUT: Duration = Duration::from_secs(60);
/// 关闭时给 guardian 自清子树的宽限。
const REAP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug)]
pub enum ChannelError {
    Dead(String),
    Timeout(&'static str),
    Io(String),
    Protocol(String),
}

impl std::fmt::Display for ChannelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChannelError::Dead(m) => write!(f, "guardian channel dead: {m}"),
            ChannelError::Timeout(what) => write!(f, "timeout waiting for guardian {what}"),
            ChannelError::Io(m) => write!(f, "guardian channel io: {m}"),
            ChannelError::Protocol(m) => write!(f, "guardian protocol violation: {m}"),
        }
    }
}

pub type ChannelResult<T> = Result<T, ChannelError>;

/// 帧编码：4 字节大端长度 + UTF-8 JSON。超限在写前拒绝。
pub fn encode_frame(value: &Value) -> ChannelResult<Vec<u8>> {
    let body = serde_json::to_vec(value).map_err(|e| ChannelError::Protocol(e.to_string()))?;
    if body.len() > MAX_FRAME_BYTES {
        return Err(ChannelError::Protocol(format!(
            "frame payload {}B exceeds limit {}B",
            body.len(),
            MAX_FRAME_BYTES
        )));
    }
    let mut frame = Vec::with_capacity(4 + body.len());
    frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
    frame.extend_from_slice(&body);
    Ok(frame)
}

type PendingMap = Arc<Mutex<HashMap<String, mpsc::Sender<ChannelResult<Value>>>>>;

/// 事件出口：壳侧注入（tauri emit），测试注入 None。
/// 关键：本模块不得引用 tauri 类型——否则 unit test exe 经 AppHandle 的
/// Drop glue 保留 wry 窗口/对话框代码，导入 comctl32 v6 专有符号
/// （TaskDialogIndirect），而无 manifest 的测试 exe 绑定 System32 v5.82，
/// 进程加载即 STATUS_ENTRYPOINT_NOT_FOUND（P4-02 实测定位）。
pub type EventSink = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// reader 线程：解析帧并 demux。死亡时结算全部待决请求。
fn spawn_reader(
    mut stdout: impl Read + Send + 'static,
    pending: PendingMap,
    sink: Option<EventSink>,
) {
    std::thread::spawn(move || {
        let dead_reason = loop {
            let mut head = [0u8; 4];
            if let Err(e) = stdout.read_exact(&mut head) {
                break format!("guardian stdout closed: {e}");
            }
            let len = u32::from_be_bytes(head) as usize;
            if len > MAX_FRAME_BYTES {
                // 毒帧：fail-closed（与 Node FrameDecoder 语义一致）。
                break format!("declared frame {len}B exceeds limit {MAX_FRAME_BYTES}B");
            }
            let mut body = vec![0u8; len];
            if let Err(e) = stdout.read_exact(&mut body) {
                break format!("guardian stdout truncated: {e}");
            }
            let env = match serde_json::from_slice::<Value>(&body) {
                Ok(value) => value,
                Err(e) => break format!("invalid JSON frame: {e}"),
            };
            let reply_to = env
                .get("in_reply_to")
                .and_then(Value::as_str)
                .map(str::to_string);
            let sender =
                reply_to.and_then(|id| pending.lock().ok().and_then(|mut map| map.remove(&id)));
            match sender {
                Some(sender) => {
                    let _ = sender.send(Ok(env));
                }
                None => {
                    // 事件帧与无主回复统一转前端事件流（UI 故障可见，SC11）。
                    if let Some(sink) = &sink {
                        let kind = env.get("kind").and_then(Value::as_str).unwrap_or("unknown");
                        let payload = env.get("payload").cloned().unwrap_or(Value::Null);
                        sink(
                            "xresconv-event",
                            json!({ "kind": kind, "payload": payload }),
                        );
                    }
                }
            }
        };
        // 死亡结算：清空待决表（不自动重放）并通知前端。
        if let Ok(mut map) = pending.lock() {
            for (_, sender) in map.drain() {
                let _ = sender.send(Err(ChannelError::Dead(dead_reason.clone())));
            }
        }
        if let Some(sink) = &sink {
            sink("xresconv-guardian-dead", json!({ "reason": dead_reason }));
        }
    });
}

pub struct GuardianClient {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: PendingMap,
    seq: AtomicU64,
}

impl GuardianClient {
    /// spawn 长驻 guardian 并完成握手（首帧必须 role=guardian 的 health）。
    /// `sink` 存在时事件帧直接转发（壳侧注入 tauri emit）；测试可传 None。
    pub fn start(sink: Option<EventSink>) -> ChannelResult<Self> {
        let node = std::env::var("XRESCONV_NODE").unwrap_or_else(|_| "node".into());
        let entry = std::env::var("XRESCONV_GUARDIAN_ENTRY").unwrap_or_else(|_| {
            // 开发态回退：从 exe 位置向上找 workspace 根（cwd 不可靠）。
            let rel = std::path::Path::new("packages")
                .join("guardian")
                .join("bin")
                .join("service.mjs");
            let mut dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()));
            loop {
                match dir {
                    Some(d) if d.join(&rel).is_file() => break d.join(&rel),
                    Some(d) => dir = d.parent().map(|p| p.to_path_buf()),
                    None => break rel.clone(),
                }
            }
            .to_string_lossy()
            .into_owned()
        });
        let mut child = Command::new(&node)
            .arg(&entry)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| ChannelError::Io(format!("spawn {node} {entry} failed: {e}")))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ChannelError::Io("guardian stdout not piped".into()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| ChannelError::Io("guardian stdin not piped".into()))?;
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        spawn_reader(stdout, pending.clone(), sink);
        let client = Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending,
            seq: AtomicU64::new(0),
        };
        // 握手：guardian 首帧无主 health 由 reader 归入事件流（无 sink 时
        // 丢弃）；这里以请求/应答 health 确认活性与协议版本（reader 按
        // in_reply_to 精确路由）。
        let health = client
            .request("health", json!({}), &["health"], HANDSHAKE_TIMEOUT)
            .inspect_err(|_| {
                let _ = client.kill();
            })?;
        if health.get("ok").and_then(Value::as_bool) != Some(true) {
            let _ = client.kill();
            return Err(ChannelError::Protocol(format!(
                "guardian handshake not ok: {health}"
            )));
        }
        Ok(client)
    }

    fn next_id(&self) -> String {
        format!(
            "shell-{}-{}",
            std::process::id(),
            self.seq.fetch_add(1, Ordering::Relaxed)
        )
    }

    fn write_envelope(&self, kind: &str, payload: Value, id: &str) -> ChannelResult<()> {
        let env = json!({
            "protocol_version": 1,
            "kind": kind,
            "id": id,
            "role": "shell",
            "payload": payload,
        });
        let frame = encode_frame(&env)?;
        let mut stdin = self
            .stdin
            .lock()
            .map_err(|_| ChannelError::Dead("stdin lock poisoned".into()))?;
        stdin
            .write_all(&frame)
            .and_then(|()| stdin.flush())
            .map_err(|e| ChannelError::Io(format!("write frame failed: {e}")))
    }

    /// 请求/应答：注册待决 → 写帧 → 有界等待。in_reply_to 由 reader 精确
    /// 路由；事件帧不经过本路径。fault 应答按 Protocol 错误结算。
    fn request(
        &self,
        kind: &str,
        payload: Value,
        expect_kinds: &[&str],
        timeout: Duration,
    ) -> ChannelResult<Value> {
        let id = self.next_id();
        let (tx, rx) = mpsc::channel::<ChannelResult<Value>>();
        self.pending
            .lock()
            .map_err(|_| ChannelError::Dead("pending lock poisoned".into()))?
            .insert(id.clone(), tx);
        let outcome = (|| {
            self.write_envelope(kind, payload, &id)?;
            let env = rx
                .recv_timeout(timeout)
                .map_err(|_| ChannelError::Timeout("reply deadline"))??;
            let kind = env.get("kind").and_then(Value::as_str).unwrap_or("");
            if kind == "fault" {
                let message = env
                    .pointer("/payload/message")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown guardian fault");
                return Err(ChannelError::Protocol(message.to_string()));
            }
            if !expect_kinds.contains(&kind) {
                return Err(ChannelError::Protocol(format!(
                    "unexpected reply kind {kind} for {id}"
                )));
            }
            Ok(env.get("payload").cloned().unwrap_or(Value::Null))
        })();
        // 超时/写失败也要摘掉待决项（迟到回复随后按无主事件处理）。
        if let Ok(mut map) = self.pending.lock() {
            map.remove(&id);
        }
        outcome
    }

    /// 健康检查（kind "health"）。
    pub fn health(&self) -> ChannelResult<Value> {
        self.request("health", json!({}), &["health"], HANDSHAKE_TIMEOUT)
    }

    /// 业务 RPC（P4-02）：kind "rpc"，应答 kind "rpc_result"。
    pub fn backend_rpc(
        &self,
        method: &str,
        params: Value,
        timeout: Option<Duration>,
    ) -> ChannelResult<Value> {
        let payload = self.request(
            "rpc",
            json!({ "type": "request", "method": method, "params": params }),
            &["rpc_result"],
            timeout.unwrap_or(DEFAULT_RPC_TIMEOUT),
        )?;
        if payload.get("ok").and_then(Value::as_bool) == Some(true) {
            Ok(payload.get("result").cloned().unwrap_or(Value::Null))
        } else {
            let message = payload
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("backend rpc failed");
            let code = payload
                .pointer("/error/code")
                .and_then(Value::as_str)
                .unwrap_or("BACKEND_ERROR");
            Err(ChannelError::Protocol(format!("{code}: {message}")))
        }
    }

    /// 显式关闭：发 shutdown，宽限内等退出，超时强杀（guardian 自清子树）。
    pub fn shutdown(&self) -> ChannelResult<()> {
        let id = self.next_id();
        // 写失败也继续收割进程。
        let _ = self.write_envelope("shutdown", json!({}), &id);
        self.reap()
    }

    fn reap(&self) -> ChannelResult<()> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| ChannelError::Dead("child lock poisoned".into()))?;
        let started = std::time::Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return Ok(()),
                Ok(None) if started.elapsed() > REAP_TIMEOUT => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(());
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
                Err(e) => return Err(ChannelError::Io(format!("wait failed: {e}"))),
            }
        }
    }

    fn kill(&self) -> ChannelResult<()> {
        let mut child = self
            .child
            .lock()
            .map_err(|_| ChannelError::Dead("child lock poisoned".into()))?;
        let _ = child.kill();
        let _ = child.wait();
        Ok(())
    }
}

impl Drop for GuardianClient {
    fn drop(&mut self) {
        // 壳退出 → stdin 关闭 → guardian EOF 自清子树（P2-09）；这里兜底强杀。
        let _ = self.kill();
    }
}

/// Tauri 托管状态：通道可重建（backend/guardian 故障后 UI 显式触发）。
pub struct GuardianState {
    client: Mutex<Option<Arc<GuardianClient>>>,
    sink: Option<EventSink>,
}

impl GuardianState {
    pub fn new(sink: Option<EventSink>) -> Self {
        Self {
            client: Mutex::new(None),
            sink,
        }
    }

    /// 取活通道；无则建立。死亡判定发生在请求路径（Dead 错误）；
    /// 调用方收到 Dead 后应显式 restart（不自动重放在途请求，SC10）。
    pub fn ensure(&self) -> ChannelResult<Arc<GuardianClient>> {
        let mut slot = self
            .client
            .lock()
            .map_err(|_| ChannelError::Dead("state lock poisoned".into()))?;
        if slot.is_none() {
            *slot = Some(Arc::new(GuardianClient::start(self.sink.clone())?));
        }
        Ok(Arc::clone(slot.as_ref().expect("checked above")))
    }

    /// 显式重启：关闭旧通道（子树自清）后清空槽位；下次 ensure 重建。
    pub fn restart(&self) -> ChannelResult<()> {
        let mut slot = self
            .client
            .lock()
            .map_err(|_| ChannelError::Dead("state lock poisoned".into()))?;
        if let Some(client) = slot.take() {
            let _ = client.shutdown();
        }
        Ok(())
    }

    pub fn shutdown(&self) -> ChannelResult<()> {
        let mut slot = self
            .client
            .lock()
            .map_err(|_| ChannelError::Dead("state lock poisoned".into()))?;
        if let Some(client) = slot.take() {
            client.shutdown()?;
        }
        Ok(())
    }

    /// 在活通道上执行操作（ensure + 借用）。
    pub fn with_client<T>(
        &self,
        f: impl FnOnce(&GuardianClient) -> ChannelResult<T>,
    ) -> ChannelResult<T> {
        let client = self.ensure()?;
        f(&client)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_codec_round_trip_big_endian() {
        let value = json!({ "hello": "世界", "n": 42 });
        let frame = encode_frame(&value).unwrap();
        let len = u32::from_be_bytes([frame[0], frame[1], frame[2], frame[3]]) as usize;
        assert_eq!(len, frame.len() - 4);
        let decoded: Value = serde_json::from_slice(&frame[4..]).unwrap();
        assert_eq!(decoded, value);
    }

    #[test]
    fn frame_encode_rejects_oversized_before_write() {
        let big = json!({ "pad": "x".repeat(MAX_FRAME_BYTES) });
        let err = encode_frame(&big).unwrap_err();
        assert!(matches!(err, ChannelError::Protocol(_)));
    }

    #[test]
    fn guardian_channel_handshake_health_shutdown() {
        // 真实 spawn：dev/CI 均有 node 与 workspace 布局；缺失即失败（不静默跳过）。
        let client = GuardianClient::start(None).expect("guardian handshake");
        let health = client.health().expect("health reply");
        assert_eq!(health.get("ok").and_then(Value::as_bool), Some(true));
        assert!(
            health.get("backend").is_some(),
            "health carries supervisor stats"
        );
        client.shutdown().expect("clean shutdown");
    }

    #[test]
    fn guardian_channel_invalid_kind_replies_correlated_fault() {
        let client = GuardianClient::start(None).expect("guardian handshake");
        // "no-such-kind" 过不了 envelope schema（kind 封闭枚举）；guardian 从
        // 原始帧尽力提取 id 回 in_reply_to（关联修复前请求方只能等超时）。
        let err = client
            .request("no-such-kind", json!({}), &["health"], HANDSHAKE_TIMEOUT)
            .unwrap_err();
        assert!(matches!(err, ChannelError::Protocol(_)), "got {err}");
        // fault 后通道仍可用（未毒化）。
        assert_eq!(
            client.health().unwrap().get("ok").and_then(Value::as_bool),
            Some(true)
        );
        client.shutdown().expect("clean shutdown");
    }

    /// 从 exe 位置向上找 workspace 根（含 packages/guardian/bin/service.mjs）。
    fn workspace_root() -> std::path::PathBuf {
        let rel = std::path::Path::new("packages")
            .join("guardian")
            .join("bin")
            .join("service.mjs");
        let mut dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()));
        loop {
            match dir {
                Some(d) if d.join(&rel).is_file() => return d,
                Some(d) => dir = d.parent().map(|p| p.to_path_buf()),
                None => panic!("workspace root not found from current_exe"),
            }
        }
    }

    /// 有界等 backend ready（health.backend.state；guardian 握手先于 backend 就绪）。
    fn wait_backend_ready(client: &GuardianClient) {
        for _ in 0..200 {
            let health = client.health().expect("health while waiting ready");
            let state = health
                .get("backend")
                .and_then(|b| b.get("state"))
                .and_then(Value::as_str);
            if state == Some("ready") {
                return;
            }
            assert_ne!(state, Some("dead"), "backend died while waiting ready");
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!("backend not ready within 20s");
    }

    #[test]
    fn guardian_channel_backend_rpc_load_config_snapshot() {
        // 全链路：Rust 壳 → guardian 中继 → 真实 backend（真实 worker 池）。
        let client = GuardianClient::start(None).expect("guardian handshake");
        wait_backend_ready(&client);
        // 未加载配置：getSnapshot 可用但 config 为空；reload 则 INVALID_STATE。
        let snap = client
            .backend_rpc("getSnapshot", json!({}), None)
            .expect("getSnapshot before load");
        assert!(snap.get("config").is_some_and(Value::is_null));
        let err = client.backend_rpc("reload", json!({}), None).unwrap_err();
        assert!(err.to_string().contains("INVALID_STATE"), "got {err}");
        // 坏 params：INVALID_PARAMS（error 结果而非 fault，通道保持可用）。
        let err = client
            .backend_rpc("loadConfig", json!({}), None)
            .unwrap_err();
        assert!(err.to_string().contains("INVALID_PARAMS"), "got {err}");
        // 加载真实夹具（run-mirror.xml：无 set_name 脚本，加载路径短）。
        let fixture =
            workspace_root().join("packages/backend/test/fixtures/service/run-mirror.xml");
        let loaded = client
            .backend_rpc("loadConfig", json!({ "path": fixture }), None)
            .expect("loadConfig");
        assert_eq!(loaded.get("state").and_then(Value::as_str), Some("ready"));
        assert!(loaded.get("tree").is_some_and(|t| !t.is_null()));
        // 事件帧不污染请求路径（无 sink 时无主事件直接丢弃）。
        let snap = client
            .backend_rpc("getSnapshot", json!({}), None)
            .expect("getSnapshot after load");
        assert!(snap.get("config").is_some_and(|c| !c.is_null()));
        assert!(snap.get("selectedItems").is_some_and(Value::is_array));
        client.shutdown().expect("clean shutdown");
    }
}
