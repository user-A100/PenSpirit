//! 相关章节 / 素材检索（阶段 2C，「语义检索」的本地实现）：字二元组 TF-IDF + 余弦相似度。
//! 不需要嵌入模型、不联网，对中文友好——长篇里「相关」主要体现为人名、地名、物件、术语的重合。
//! 百万字级每次现算即可（只扫一遍文本）；每条命中顺带给出最相关的一段（注入用）与摘录（展示用）。

use std::collections::{HashMap, HashSet};

/// 注入用的相关段落上限（字符数）
pub const PASSAGE_MAX_CHARS: usize = 1200;
const SNIPPET_CHARS: usize = 60;

#[derive(Debug, Clone)]
pub struct Doc {
    pub kind: String,
    pub id: i64,
    pub title: String,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct RelatedHit {
    pub kind: String,
    pub id: i64,
    pub title: String,
    /// 0–1 余弦相似度
    pub score: f64,
    pub snippet: String,
    pub passage: String,
}

/// 文本里的字二元组（只取相邻两个「文字」——汉字 / 字母 / 数字，标点空白断开）
fn grams(text: &str) -> HashMap<u64, u32> {
    let mut out = HashMap::new();
    let mut prev: Option<char> = None;
    for c in text.chars() {
        if c.is_alphanumeric() {
            if let Some(p) = prev {
                *out.entry(((p as u64) << 32) | c as u64).or_insert(0) += 1;
            }
            prev = Some(c);
        } else {
            prev = None;
        }
    }
    out
}

fn weigh(g: &HashMap<u64, u32>, idf: &dyn Fn(u64) -> f64) -> (HashMap<u64, f64>, f64) {
    let mut v = HashMap::with_capacity(g.len());
    let mut norm = 0.0;
    for (&k, &tf) in g {
        let w = (1.0 + (tf as f64).ln()) * idf(k);
        norm += w * w;
        v.insert(k, w);
    }
    (v, norm.sqrt())
}

/// 文档里与查询最相关的一段：按段落打分（共有二元组的 idf 之和），取最高的一段并向前后扩到上限
fn best_passage(text: &str, query: &HashSet<u64>, idf: &dyn Fn(u64) -> f64) -> (String, String) {
    let paras: Vec<&str> = text.split('\n').map(|p| p.trim()).filter(|p| !p.is_empty()).collect();
    if paras.is_empty() {
        return (String::new(), String::new());
    }
    let score = |p: &str| grams(p).keys().filter(|k| query.contains(k)).map(|&k| idf(k)).sum::<f64>();
    let best = (0..paras.len()).max_by(|&a, &b| score(paras[a]).partial_cmp(&score(paras[b])).unwrap_or(std::cmp::Ordering::Equal)).unwrap_or(0);
    let snippet: String = paras[best].chars().take(SNIPPET_CHARS).collect();
    let (mut lo, mut hi) = (best, best);
    let mut len = paras[best].chars().count();
    loop {
        let mut grew = false;
        if hi + 1 < paras.len() && len + paras[hi + 1].chars().count() <= PASSAGE_MAX_CHARS {
            hi += 1;
            len += paras[hi].chars().count();
            grew = true;
        }
        if lo > 0 && len + paras[lo - 1].chars().count() <= PASSAGE_MAX_CHARS {
            lo -= 1;
            len += paras[lo].chars().count();
            grew = true;
        }
        if !grew {
            break;
        }
    }
    let passage: String = paras[lo..=hi].join("\n").chars().take(PASSAGE_MAX_CHARS).collect();
    (snippet, passage)
}

/// 按与查询的相关度给文档排序，取前 limit 条（相似度太低的不要）
pub fn rank(query: &str, docs: &[Doc], limit: usize) -> Vec<RelatedHit> {
    let qg = grams(query);
    if qg.is_empty() || docs.is_empty() {
        return Vec::new();
    }
    let doc_grams: Vec<HashMap<u64, u32>> = docs.iter().map(|d| grams(&format!("{}\n{}", d.title, d.text))).collect();
    let mut df: HashMap<u64, u32> = HashMap::new();
    for g in &doc_grams {
        for &k in g.keys() {
            *df.entry(k).or_insert(0) += 1;
        }
    }
    let n = docs.len() as f64;
    let idf = |k: u64| ((n + 1.0) / (*df.get(&k).unwrap_or(&0) as f64 + 1.0)).ln() + 1.0;
    let (qv, qn) = weigh(&qg, &idf);
    if qn == 0.0 {
        return Vec::new();
    }
    let qset: HashSet<u64> = qg.keys().copied().collect();
    let mut scored: Vec<(f64, usize)> = doc_grams
        .iter()
        .enumerate()
        .filter_map(|(i, g)| {
            let (dv, dn) = weigh(g, &idf);
            if dn == 0.0 {
                return None;
            }
            let dot: f64 = qv.iter().filter_map(|(k, w)| dv.get(k).map(|d| d * w)).sum();
            let s = dot / (qn * dn);
            (s > 0.03).then_some((s, i))
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    scored
        .into_iter()
        .take(limit)
        .map(|(s, i)| {
            let d = &docs[i];
            let (snippet, passage) = best_passage(&d.text, &qset, &idf);
            RelatedHit { kind: d.kind.clone(), id: d.id, title: d.title.clone(), score: (s * 1000.0).round() / 1000.0, snippet, passage }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(id: i64, title: &str, text: &str) -> Doc {
        Doc { kind: "chapter".into(), id, title: title.into(), text: text.into() }
    }

    #[test]
    fn 人名地名重合的排在前面_给出最相关的一段() {
        let docs = vec![
            doc(1, "渡口", "渡口的灯笼次第亮起。\n沈砚站在船头，望着旧城。\n雪下了一夜。"),
            doc(2, "皇城", "皇帝在大殿上召见群臣。\n丞相出列奏事。"),
            doc(3, "雪夜", "那年冬天很冷。\n沈砚在渡口救下林晚，雪夜里两人渡河。"),
        ];
        let hits = rank("沈砚又回到渡口，想起雪夜里的林晚", &docs, 5);
        assert_eq!(hits.iter().map(|h| h.id).collect::<Vec<_>>(), vec![3, 1]);
        assert!(hits[0].snippet.contains("沈砚在渡口救下林晚"));
        assert!(hits[0].passage.contains("那年冬天很冷"), "段落向前后扩到上限");
        assert!(hits[0].score > hits[1].score);
    }

    #[test]
    fn 空查询或无重合不返回() {
        let docs = vec![doc(1, "a", "完全无关的内容")];
        assert!(rank("，。！", &docs, 5).is_empty());
        assert!(rank("沈砚", &docs, 5).is_empty());
    }
}
