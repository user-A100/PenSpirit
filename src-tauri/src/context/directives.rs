//! 正文里的 AI 指令（阶段 2C，NovelAI / Novelcrafter 式）：
//! - `{…}` 作者批注：只给 AI 看的要求（「林晚此时还不知道真相」），永不写进正文；
//! - `[…]` 待写指令：此处要写什么（「这里写一场雨中打斗，要短」），光标放进去按 Alt+Enter 由 AI 写成正文替换掉它。
//! 发给 AI 的正文上下文里两者都剔除（它们不是正文）；批注单列成槽位。`[[章题]]` 是 wiki 链接，不算。
//! 只认半角括号，单行、限长（防误吞正文）。`arr[0]` 这类紧跟英文 / 数字的、`[1]` 这类纯数字（脚注号）都不算。

pub const NOTE_MAX_CHARS: usize = 300;
pub const TODO_MAX_CHARS: usize = 300;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Directives {
    /// 剔除指令后的正文
    pub clean: String,
    /// `{…}` 批注（去括号、去首尾空白）
    pub notes: Vec<String>,
    /// `[…]` 待写指令
    pub todos: Vec<String>,
}

/// 从 i（指向开括号）起找同一行内的闭括号，内容长度不超过 max；返回闭括号下标
fn close_of(chars: &[char], i: usize, open: char, close: char, max: usize) -> Option<usize> {
    let mut j = i + 1;
    while j < chars.len() && j - i - 1 <= max {
        match chars[j] {
            c if c == close => return (j > i + 1).then_some(j),
            '\n' => return None,
            c if c == open => return None,
            _ => j += 1,
        }
    }
    None
}

pub fn split(text: &str) -> Directives {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Directives::default();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '{' {
            if let Some(j) = close_of(&chars, i, '{', '}', NOTE_MAX_CHARS) {
                let inner: String = chars[i + 1..j].iter().collect();
                if !inner.trim().is_empty() {
                    out.notes.push(inner.trim().to_string());
                }
                i = j + 1;
                continue;
            }
        } else if c == '[' {
            // [[wiki]] 原样保留（含闭合的 ]]）
            if chars.get(i + 1) == Some(&'[') {
                if let Some(end) = (i + 2..chars.len().saturating_sub(1)).find(|&k| chars[k] == ']' && chars[k + 1] == ']') {
                    out.clean.extend(&chars[i..end + 2]);
                    i = end + 2;
                    continue;
                }
            } else if let Some(j) = close_of(&chars, i, '[', ']', TODO_MAX_CHARS) {
                let after_word = i > 0 && (chars[i - 1].is_ascii_alphanumeric() || chars[i - 1] == '_');
                let footnote = chars[i + 1..j].iter().all(|c| c.is_ascii_digit() || c.is_whitespace());
                if chars.get(j + 1) != Some(&']') && !after_word && !footnote {
                    let inner: String = chars[i + 1..j].iter().collect();
                    if !inner.trim().is_empty() {
                        out.todos.push(inner.trim().to_string());
                    }
                    i = j + 1;
                    continue;
                }
            }
        }
        out.clean.push(c);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 批注与待写指令剔除_wiki链接保留() {
        let d = split("林晚推门而入。{她此时还不知道真相}\n[这里写一场雨中打斗，要短]\n她想起[[第一章 渡口]]的事。");
        assert_eq!(d.clean, "林晚推门而入。\n\n她想起[[第一章 渡口]]的事。");
        assert_eq!(d.notes, vec!["她此时还不知道真相"]);
        assert_eq!(d.todos, vec!["这里写一场雨中打斗，要短"]);
    }

    #[test]
    fn 下标与脚注号不算指令() {
        let d = split("数组 arr[0] 取值，见注[12]。[真的指令]");
        assert_eq!(d.todos, vec!["真的指令"]);
        assert_eq!(d.clean, "数组 arr[0] 取值，见注[12]。");
    }

    #[test]
    fn 跨行或超长或空的括号不算指令() {
        let long = format!("{{{}}}", "字".repeat(NOTE_MAX_CHARS + 1));
        let d = split(&format!("a{{跨\n行}}b[]c{{}}d{long}"));
        assert!(d.notes.is_empty() && d.todos.is_empty());
        assert_eq!(d.clean, format!("a{{跨\n行}}b[]c{{}}d{long}"));
    }
}
