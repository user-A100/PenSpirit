//! 一次性短连接探测：spawn → initialize → 读取 agent 信息与
//! session capabilities → 结束即 kill。
//!
//! spawn 由 `agent-client-protocol` SDK 的 `AcpAgent` 完成：
//! Windows 下内部已设 CREATE_NO_WINDOW (0x0800_0000)，连接结束时
//! ChildGuard 会 kill 整个进程树（Unix 为进程组）。探测期收到的
//! 权限请求一律自动拒绝（Cancelled），不阻塞 dispatch loop。
//! 探测永不 panic：所有失败路径都收敛为 `ProbeResult { ok: false }`。

use std::time::Duration;

use agent_client_protocol::schema::v1::{
    InitializeRequest, McpServer, McpServerStdio, RequestPermissionRequest,
    RequestPermissionOutcome, RequestPermissionResponse,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};

use crate::agents::discover;
use crate::models::{AgentDescriptor, ProbeResult};

/// initialize 预算（冷启动的 agent 运行时可能较慢）。
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

fn failed(detail: String) -> ProbeResult {
    ProbeResult {
        ok: false,
        agent_name: None,
        protocol_version: None,
        can_resume: false,
        detail: Some(detail),
    }
}

/// 对单个 agent 做短连接探测。命令未安装 / 握手失败 / 超时
/// 均返回 `ok: false` 与可读原因，绝不 panic。
pub async fn probe(desc: &AgentDescriptor) -> ProbeResult {
    // 1. 命令发现（GUI 进程 PATH 与终端不同）
    let Some(command) = discover::resolve_command(&desc.command) else {
        return failed(format!(
            "未找到命令 `{}`：请先安装对应 ACP 适配器（设置面板有安装指引）",
            desc.command
        ));
    };

    // 2. 构建 stdio 传输的 agent 进程描述（env 继承本进程）
    let stdio = McpServerStdio::new(desc.id.clone(), command).args(desc.args.clone());
    let agent = AcpAgent::new(McpServer::Stdio(stdio));

    // 3. 连接 + initialize；探测期权限请求自动拒绝
    let connect = Client
        .builder()
        .name("bixian")
        .on_receive_request(
            async |_req: RequestPermissionRequest, responder, _cx: ConnectionTo<Agent>| {
                let _ =
                    responder.respond(RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled));
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, |connection: ConnectionTo<Agent>| async move {
            let init = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            Ok(ProbeResult {
                ok: true,
                agent_name: init.agent_info.as_ref().map(|i| i.name.clone()),
                protocol_version: Some(format!("v{}", init.protocol_version.as_u16())),
                can_resume: init
                    .agent_capabilities
                    .session_capabilities
                    .resume
                    .is_some(),
                detail: None,
            })
        });

    // 4. 超时包裹；连接结束（成功/失败）后 SDK 自动 kill 子进程树
    match tokio::time::timeout(PROBE_TIMEOUT, connect).await {
        Err(_) => failed(format!(
            "探测超时（{} 秒）：agent 未在期限内完成初始化",
            PROBE_TIMEOUT.as_secs()
        )),
        Ok(Err(e)) => failed(format!("初始化失败: {e}")),
        Ok(Ok(mut r)) => {
            r.ok = true;
            r
        }
    }
}
