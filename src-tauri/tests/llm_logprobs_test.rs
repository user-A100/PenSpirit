//! 阶段 2C：此处下一个词的备选与概率（logprobs）。本地起一个一次性的 SSE 服务模拟服务商。

use bixian::llm::stream::{next_token_alternatives, StreamReq};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// 起一个只接一次请求的服务：回一串 SSE 分片；返回 base_url 与「收到的请求体」
async fn serve_once(chunks: Vec<String>) -> (String, tokio::task::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let h = tokio::spawn(async move {
        let (mut sock, _) = listener.accept().await.unwrap();
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        loop {
            let n = sock.read(&mut tmp).await.unwrap();
            buf.extend_from_slice(&tmp[..n]);
            let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") else { continue };
            let head = String::from_utf8_lossy(&buf[..pos]).to_ascii_lowercase();
            let len = head
                .lines()
                .find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap()))
                .unwrap_or(0);
            while buf.len() < pos + 4 + len {
                let n = sock.read(&mut tmp).await.unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
            }
            let body = String::from_utf8_lossy(&buf[pos + 4..]).to_string();
            let mut resp = String::from("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-cache\r\nconnection: close\r\n\r\n");
            for c in &chunks {
                resp.push_str(&format!("data: {c}\n\n"));
            }
            resp.push_str("data: [DONE]\n\n");
            sock.write_all(resp.as_bytes()).await.unwrap();
            sock.shutdown().await.ok();
            return body;
        }
    });
    (format!("http://{addr}/v1"), h)
}

fn req(base_url: String) -> StreamReq {
    StreamReq {
        base_url,
        api_key: "sk-test".into(),
        model: "m".into(),
        system: "s".into(),
        history: Vec::new(),
        user: "u".into(),
        max_tokens: 4,
        temperature: 1.0,
    }
}

#[tokio::test]
async fn 备选词_按概率排序_空白丢弃_请求带_logprobs() {
    let chunk = r#"{"id":"x","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"雨"},"logprobs":{"content":[{"token":"雨","logprob":-0.5,"bytes":null,"top_logprobs":[{"token":"风","logprob":-1.2,"bytes":null},{"token":"雨","logprob":-0.5,"bytes":null},{"token":" ","logprob":-3.0,"bytes":null}]}],"refusal":null},"finish_reason":null}]}"#;
    let (url, h) = serve_once(vec![chunk.to_string()]).await;
    let out = next_token_alternatives(req(url), 8).await.unwrap().unwrap();
    let body = h.await.unwrap();
    assert!(body.contains("\"logprobs\":true") && body.contains("\"top_logprobs\":8"), "{body}");
    assert_eq!(out.iter().map(|(t, _)| t.as_str()).collect::<Vec<_>>(), vec!["雨", "风"]);
    assert!((out[0].1 - (-0.5f32).exp()).abs() < 1e-5);
}

#[tokio::test]
async fn 服务商不回概率_返回_none() {
    let chunk = r#"{"id":"x","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":"雨"},"finish_reason":null}]}"#;
    let (url, _h) = serve_once(vec![chunk.to_string()]).await;
    assert!(next_token_alternatives(req(url), 8).await.unwrap().is_none());
}
