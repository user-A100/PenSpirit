//! 流式增量合并器：把高频 `AgentMessageChunk` 攒进缓冲，按时间片
//! （默认 40ms，≤25 次/秒）flush 给前端，避免 webview 事件洪水。
//! 时间由调用方注入（`Instant`），便于确定性测试。

use std::time::{Duration, Instant};

/// flush 时间片：25 次/秒 上限。
pub const FLUSH_INTERVAL: Duration = Duration::from_millis(40);

#[derive(Default)]
pub struct StreamCoalescer {
    buf: String,
    last_flush: Option<Instant>,
}

impl StreamCoalescer {
    pub fn new() -> Self {
        Self::default()
    }

    /// 追加一段流式文本（保持顺序）。
    pub fn push(&mut self, text: &str) {
        self.buf.push_str(text);
    }

    /// 距上次 flush ≥ FLUSH_INTERVAL 且缓冲非空时取走全部缓冲。
    pub fn take_if_due(&mut self, now: Instant) -> Option<String> {
        let due = match self.last_flush {
            None => true, // 首个 chunk 立即可见
            Some(t) => now.duration_since(t) >= FLUSH_INTERVAL,
        };
        if due && !self.buf.is_empty() {
            self.last_flush = Some(now);
            Some(std::mem::take(&mut self.buf))
        } else {
            None
        }
    }

    /// 取走剩余缓冲（回合结束时必调，保证不丢尾巴）。
    pub fn take_all(&mut self) -> Option<String> {
        if self.buf.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.buf))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 首个chunk立即flush() {
        let mut c = StreamCoalescer::new();
        c.push("你好");
        assert_eq!(c.take_if_due(Instant::now()), Some("你好".into()));
        assert_eq!(c.take_all(), None);
    }

    #[test]
    fn 时间片内合并为一次() {
        let mut c = StreamCoalescer::new();
        let t0 = Instant::now();
        c.push("a");
        assert_eq!(c.take_if_due(t0), Some("a".into()));
        c.push("b");
        c.push("c");
        // 40ms 内不再 flush
        assert_eq!(c.take_if_due(t0 + Duration::from_millis(10)), None);
        assert_eq!(c.take_if_due(t0 + Duration::from_millis(39)), None);
        // 到期后一次性带出，且顺序完整
        assert_eq!(c.take_if_due(t0 + FLUSH_INTERVAL), Some("bc".into()));
    }

    #[test]
    fn 回合结束取走全部() {
        let mut c = StreamCoalescer::new();
        let t0 = Instant::now();
        c.push("x");
        let _ = c.take_if_due(t0);
        c.push("y");
        c.push("z");
        assert_eq!(c.take_all(), Some("yz".into()));
        assert_eq!(c.take_all(), None);
    }

    #[test]
    fn 空缓冲不flush也不刷新时间片() {
        let mut c = StreamCoalescer::new();
        let t0 = Instant::now();
        assert_eq!(c.take_if_due(t0), None);
        assert_eq!(c.last_flush, None, "空 flush 不应占用时间片");
        c.push("q");
        assert_eq!(c.take_if_due(t0 + Duration::from_millis(5)), Some("q".into()));
    }
}
