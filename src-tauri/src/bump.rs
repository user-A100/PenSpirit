//! M2-T10 碰碰车：词库存储与随机抽取。
//!
//! 抽取用自带 xorshift 而非引 rand——只需均匀性够用，且**种子显式入参**，
//! 测试可确定性断言（"随机抽取确定性——种子可测"）。

use crate::commands::lock;
use crate::error::{AppError, AppResult};
use crate::models::{BumpWord, Idea};
use crate::repo;
use crate::state::AppState;

/// 词长上限（字符）：防止把整段话粘进词库
pub const MAX_WORD_CHARS: usize = 20;

/// 64 位 xorshift 伪随机数发生器（种子为 0 时换固定非零值，避免退化）
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed })
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    /// [0, n) 上的均匀取值
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

/// 从词库抽 count 个不重复的词。只做部分洗牌：洗前 count 个即可。
/// count 大于词库规模时返回全部（顺序已被打乱）。
pub fn draw(words: &[String], count: usize, seed: u64) -> Vec<String> {
    let mut pool = words.to_vec();
    let n = count.min(pool.len());
    let mut rng = Rng::new(seed);
    for i in 0..n {
        let j = i + rng.below(pool.len() - i);
        pool.swap(i, j);
    }
    pool.truncate(n);
    pool
}

/// 当前时间纳秒作种子（无需密码学强度，只要每组不同）
fn time_seed() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x5DEE_CE66_D000_0000)
}

// ---- 词库 ----

pub fn list_words_inner(s: &AppState) -> AppResult<Vec<BumpWord>> {
    repo::bump::list(&*lock(s)?)
}

pub fn add_word_inner(s: &AppState, word: &str) -> AppResult<BumpWord> {
    let word = word.trim();
    if word.is_empty() {
        return Err(AppError::Invalid("词不能为空".into()));
    }
    if word.chars().count() > MAX_WORD_CHARS {
        return Err(AppError::Invalid(format!("词最多 {MAX_WORD_CHARS} 个字")));
    }
    repo::bump::add(&*lock(s)?, word)
}

pub fn delete_word_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::bump::delete(&*lock(s)?, id)
}

pub fn clear_words_inner(s: &AppState) -> AppResult<()> {
    repo::bump::clear(&*lock(s)?)
}

/// 碰撞：取词库词随机抽 count 个（2-4）
pub fn draw_inner(s: &AppState, count: i64) -> AppResult<Vec<String>> {
    let count = count.clamp(2, 4) as usize;
    let words: Vec<String> = repo::bump::list(&*lock(s)?)?.into_iter().map(|w| w.word).collect();
    if words.len() < count {
        return Err(AppError::Invalid(format!("词库至少需要 {count} 个词")));
    }
    Ok(draw(&words, count, time_seed()))
}

// ---- 灵感卡 ----

pub fn list_ideas_inner(s: &AppState) -> AppResult<Vec<Idea>> {
    repo::ideas::list(&*lock(s)?)
}

pub fn create_idea_inner(
    s: &AppState,
    content: &str,
    words_json: &str,
    tags_json: &str,
) -> AppResult<Idea> {
    let words: Vec<String> = serde_json::from_str(words_json).unwrap_or_default();
    if words.is_empty() {
        return Err(AppError::Invalid("灵感卡至少需要一个词".into()));
    }
    // 规范化存储：words/tags 都过一遍 serde，挡住前端传来的非法 JSON
    let words_json = serde_json::to_string(&words).map_err(|e| AppError::Invalid(e.to_string()))?;
    let tags: Vec<String> = serde_json::from_str::<Vec<String>>(tags_json)
        .unwrap_or_default()
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let tags_json = serde_json::to_string(&tags).map_err(|e| AppError::Invalid(e.to_string()))?;
    repo::ideas::create(&*lock(s)?, content.trim(), &words_json, &tags_json)
}

pub fn delete_idea_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::ideas::delete(&*lock(s)?, id)
}
