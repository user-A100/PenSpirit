use async_openai::config::OpenAIConfig;
use async_openai::types::chat::{
    ChatCompletionRequestAssistantMessage, ChatCompletionRequestMessage,
    ChatCompletionRequestSystemMessage, ChatCompletionRequestUserMessage,
    CreateChatCompletionRequestArgs,
};
use futures::StreamExt;
use tokio::sync::{mpsc, watch};

use crate::error::{AppError, AppResult};

/// 流式事件统一信封，经 `emit("stream://{session_id}")` 推给前端。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Delta { text: String },
    Done { session_id: i64, content: String },
    Error { message: String },
}

/// 一次流式续写的请求参数（从 ProviderProfile + 组装结果构造）。
#[derive(Debug, Clone)]
pub struct StreamReq {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub system: String,
    pub history: Vec<(String, String)>, // (role, content)
    pub user: String,
    pub max_tokens: i64,
    pub temperature: f64,
}

/// 解析单条 SSE 行：`data: {...}` → delta content 文本；`[DONE]`/心跳/空行/无 content → None。
pub fn parse_sse_line(line: &str) -> Option<String> {
    let payload = line.strip_prefix("data:")?.trim_start();
    if payload == "[DONE]" {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(payload).ok()?;
    v.get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()
        .map(|s| s.to_string())
}

/// 错误信息可能回显请求体（含 api_key）；统一把 key 替换为占位符后再对外。
fn sanitize(message: &str, api_key: &str) -> String {
    if api_key.is_empty() {
        message.to_string()
    } else {
        message.replace(api_key, "***")
    }
}

fn to_message(role: &str, content: &str) -> ChatCompletionRequestMessage {
    match role {
        "assistant" => ChatCompletionRequestMessage::Assistant(
            ChatCompletionRequestAssistantMessage::from(content),
        ),
        "system" => {
            ChatCompletionRequestMessage::System(ChatCompletionRequestSystemMessage::from(content))
        }
        _ => ChatCompletionRequestMessage::User(ChatCompletionRequestUserMessage::from(content)),
    }
}

/// 发起流式对话：立即返回事件接收端，后台任务把增量经 mpsc 转发；
/// watch 通道变 true 时取消（已收到的增量保留在 Done 里）；任何请求失败发一次
/// `StreamEvent::Error` 后结束（错误文本保留原始信息但绝不包含 api_key）。
pub async fn chat_stream(
    req: StreamReq,
    session_id: i64,
    mut cancelled: watch::Receiver<bool>,
) -> AppResult<mpsc::Receiver<StreamEvent>> {
    // 容量给足，避免 emit 循环背压卡死转发任务。
    let (tx, rx) = mpsc::channel::<StreamEvent>(256);

    // messages 顺序 = system + history + user
    let mut messages = vec![to_message("system", &req.system)];
    for (role, content) in &req.history {
        messages.push(to_message(role, content));
    }
    messages.push(to_message("user", &req.user));

    let request = CreateChatCompletionRequestArgs::default()
        .model(req.model.clone())
        .messages(messages)
        .temperature(req.temperature as f32)
        .max_tokens(req.max_tokens.clamp(1, u32::MAX as i64) as u32)
        .build()
        .map_err(|e| AppError::Invalid(sanitize(&format!("AI 请求构建失败: {e}"), &req.api_key)))?;

    let client = async_openai::Client::with_config(
        OpenAIConfig::new()
            .with_api_base(req.base_url.clone())
            .with_api_key(req.api_key.clone()),
    );

    let mut stream = match client.chat().create_stream(request).await {
        Ok(s) => s,
        Err(e) => {
            let message = sanitize(&e.to_string(), &req.api_key);
            let _ = tx.send(StreamEvent::Error { message }).await;
            return Ok(rx);
        }
    };

    // key 只在本任务内用于脱敏，不进入任何对外消息。
    let api_key = req.api_key;
    tokio::spawn(async move {
        let mut full = String::new();
        // 发送端被 drop（无法再取消）时不再 select watch，避免 changed() 的 Err 空转。
        let mut watch_alive = true;
        loop {
            let item = if watch_alive {
                tokio::select! {
                    changed = cancelled.changed() => {
                        match changed {
                            Ok(_) => {
                                if *cancelled.borrow_and_update() {
                                    break;
                                }
                                continue;
                            }
                            Err(_) => {
                                watch_alive = false;
                                continue;
                            }
                        }
                    }
                    item = stream.next() => item,
                }
            } else {
                stream.next().await
            };
            match item {
                Some(Ok(chunk)) => {
                    for choice in chunk.choices {
                        if let Some(text) = choice.delta.content {
                            full.push_str(&text);
                            if tx.send(StreamEvent::Delta { text }).await.is_err() {
                                return; // 接收端已丢弃，无人监听
                            }
                        }
                    }
                }
                Some(Err(e)) => {
                    let message = sanitize(&e.to_string(), &api_key);
                    let _ = tx.send(StreamEvent::Error { message }).await;
                    return;
                }
                None => break, // 正常流结束
            }
        }
        let _ = tx.send(StreamEvent::Done { session_id, content: full }).await;
    });

    Ok(rx)
}
