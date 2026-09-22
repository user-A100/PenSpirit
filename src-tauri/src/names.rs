//! M7 批次7 名字生成器：内建中文姓名语料 + 约束控制面（性别/开头/含有/生僻度/数量）。
//! 随机走 bump 同款 xorshift、种子显式入参（可复现）；不用引 rand。
//! 匹配按汉字前缀/包含（不做拼音映射）。

use std::collections::HashSet;

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

/// 常见姓氏（单字）。
const SURNAMES: &[&str] = &[
    "王", "李", "张", "刘", "陈", "杨", "黄", "赵", "吴", "周", "徐", "孙", "马", "朱", "胡", "郭", "何",
    "高", "林", "罗", "郑", "梁", "谢", "宋", "唐", "许", "韩", "冯", "邓", "曹", "彭", "曾", "肖", "田",
    "董", "袁", "潘", "于", "蒋", "蔡", "余", "杜", "叶", "程", "苏", "魏", "吕", "丁", "任", "沈", "姚",
    "卢", "姜", "崔", "钟", "谭", "陆", "汪", "范", "金", "石", "廖", "贾", "夏", "韦", "傅", "方", "白",
    "邹", "孟", "熊", "秦", "邱", "江", "尹", "薛", "闫", "段", "雷", "侯", "龙", "史", "陶", "黎", "贺",
    "顾", "毛", "郝", "龚", "邵", "万", "钱", "严", "覃", "武", "戴", "莫", "孔", "向", "汤", "常", "温",
    "康", "施", "文", "牛", "樊", "葛", "邢", "安", "齐", "易", "乔", "伍", "庞", "颜", "倪", "庄", "聂",
    "章", "鲁", "岳", "翟", "殷", "詹", "申", "欧", "耿", "关", "兰", "焦", "俞", "左", "柳", "甘", "祝",
];

/// 生僻/复姓（生僻度=rare 时启用）。
const SURNAMES_RARE: &[&str] = &[
    "慕容", "欧阳", "上官", "司徒", "司马", "诸葛", "夏侯", "皇甫", "尉迟", "公孙", "长孙", "宇文",
    "轩辕", "令狐", "钟离", "独孤", "南宫", "西门", "东郭", "百里", "呼延", "端木", "申屠", "澹台",
    "公冶", "太叔", "拓跋", "贺兰", "闻人", "赫连", "竺", "逯", "桓", "郗", "璩", "逄", "夔", "乜",
];

/// 名（男·常用字）。
const GIVEN_M: &[&str] = &[
    "伟", "强", "军", "磊", "涛", "斌", "鹏", "飞", "宇", "轩", "浩", "然", "志", "明", "建", "永", "昊",
    "天", "佑", "博", "文", "泽", "楷", "瑞", "霖", "翰", "峰", "旭", "东", "振", "华", "嘉", "煜", "烨",
    "皓", "擎", "睿", "绍", "鑫", "晋", "杰", "健", "柏", "鹤", "祺", "荣", "彬", "风", "靖", "诚", "高",
    "格", "光", "启", "弘", "鸿", "朗", "瑾", "瑜", "锦", "景", "澄", "俊", "晖", "坤", "锐", "澜", "良",
    "骥", "谦", "毅", "骋", "恒", "立", "远", "山", "川", "岳",
];

/// 名（女·常用字）。
const GIVEN_F: &[&str] = &[
    "芳", "娟", "敏", "静", "丽", "娜", "燕", "婷", "雪", "梅", "琳", "晶", "云", "霞", "玉", "小", "巧",
    "惠", "美", "兰", "凤", "洁", "琼", "桂", "英", "彩", "虹", "月", "秀", "婉", "怡", "欣", "悦", "佳",
    "颖", "慧", "雅", "芝", "妍", "茜", "秋", "珊", "莎", "绮", "卉", "园", "圆", "心", "璐", "岚", "茗",
    "晗", "蕾", "薇", "媛", "嫣", "彤", "菲", "玲", "琪", "琴",
];

/// 名（男·生僻字，生僻度=rare 时启用）。
const GIVEN_M_RARE: &[&str] = &[
    "昱", "珩", "翊", "瑄", "朔", "衍", "洛", "聿", "淮", "笙", "晏", "岑", "沂", "昭", "旻", "砚", "渊",
    "迟", "隐", "渡", "屿", "辞", "叙", "阙", "戬", "赟", "燚", "翀", "昉", "勖",
];

/// 名（女·生僻字）。
const GIVEN_F_RARE: &[&str] = &[
    "芷", "莞", "菱", "荃", "蘅", "绾", "黛", "裳", "素", "梧", "棠", "栀", "茉", "离", "枝", "檀", "眉",
    "初", "卿", "沅", "澧", "菡", "媱", "姒", "姈", "娆", "嫮", "婳", "瑷", "瓯",
];

#[derive(Debug, Clone, Deserialize)]
pub struct NameRequest {
    /// any | male | female
    pub gender: String,
    /// 名以该字开头（可为空）
    #[serde(default)]
    pub starts_with: String,
    /// 名含该字（可为空）
    #[serde(default)]
    pub contains: String,
    /// any | common | rare
    pub obscurity: String,
    /// 最多返回条数（1..=50）
    pub count: i64,
    /// xorshift 种子（前端传当日/上次种子即可复现）
    pub seed: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeneratedName {
    pub full: String,
    pub surname: String,
    pub given: String,
    /// male | female
    pub gender: String,
    pub rare: bool,
}

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64：均匀性对选词够用（同 bump.rs）
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn pick<'a>(&mut self, arr: &'a [&'a str]) -> &'a str {
        arr[(self.next() % arr.len() as u64) as usize]
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.next() % 100 < pct
    }
}

fn validate(req: &NameRequest) -> AppResult<()> {
    if !matches!(req.gender.as_str(), "any" | "male" | "female") {
        return Err(AppError::Invalid(format!("未知性别：{}", req.gender)));
    }
    if !matches!(req.obscurity.as_str(), "any" | "common" | "rare") {
        return Err(AppError::Invalid(format!("未知生僻度：{}", req.obscurity)));
    }
    if !(1..=50).contains(&req.count) {
        return Err(AppError::Invalid("数量需在 1..=50 之间".into()));
    }
    if req.starts_with.chars().count() > 1 {
        return Err(AppError::Invalid("「开头」最多一个字".into()));
    }
    if req.contains.chars().count() > 1 {
        return Err(AppError::Invalid("「含有」最多一个字".into()));
    }
    Ok(())
}

/// 生成去重后的候选名；约束太紧时返回能凑到的全部（不足 count 不报错）。
pub fn generate_inner(req: &NameRequest) -> AppResult<Vec<GeneratedName>> {
    validate(req)?;
    let mut rng = Rng(req.seed | 1);
    let want = req.count.clamp(1, 50) as usize;
    let mut out: Vec<GeneratedName> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for _ in 0..want * 60 {
        if out.len() >= want {
            break;
        }
        let gender = match req.gender.as_str() {
            "male" => "male",
            "female" => "female",
            _ => if rng.chance(50) { "male" } else { "female" },
        };
        let (common_pool, rare_pool) = if gender == "male" {
            (GIVEN_M, GIVEN_M_RARE)
        } else {
            (GIVEN_F, GIVEN_F_RARE)
        };
        let rare = match req.obscurity.as_str() {
            "common" => false,
            "rare" => true,
            _ => rng.chance(15),
        };
        let surname = if rare {
            if rng.chance(70) {
                rng.pick(SURNAMES_RARE)
            } else {
                rng.pick(SURNAMES)
            }
        } else {
            rng.pick(SURNAMES)
        };
        let pool = if rare { rare_pool } else { common_pool };
        // 单字名 25%，双字名 75%
        let given = if rng.chance(25) {
            rng.pick(pool).to_string()
        } else {
            let a = rng.pick(pool);
            let mut b = rng.pick(pool);
            while b == a {
                b = rng.pick(pool);
            }
            format!("{a}{b}")
        };
        if !req.starts_with.is_empty() && !given.starts_with(&req.starts_with) {
            continue;
        }
        if !req.contains.is_empty() && !given.contains(&req.contains) {
            continue;
        }
        let full = format!("{surname}{given}");
        if seen.insert(full.clone()) {
            out.push(GeneratedName {
                full,
                surname: surname.to_string(),
                given,
                gender: gender.to_string(),
                rare,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(gender: &str, starts_with: &str, contains: &str, obscurity: &str, count: i64) -> NameRequest {
        NameRequest {
            gender: gender.into(),
            starts_with: starts_with.into(),
            contains: contains.into(),
            obscurity: obscurity.into(),
            count,
            seed: 42,
        }
    }

    #[test]
    fn generates_requested_count_without_duplicates() {
        let names = generate_inner(&req("any", "", "", "any", 30)).unwrap();
        assert_eq!(names.len(), 30);
        let set: HashSet<_> = names.iter().map(|n| n.full.as_str()).collect();
        assert_eq!(set.len(), 30);
        for n in &names {
            assert!(!n.surname.is_empty());
            assert!(!n.given.is_empty());
            assert!(n.full.starts_with(&n.surname));
        }
    }

    #[test]
    fn constraints_narrow_the_output() {
        let names = generate_inner(&req("female", "芷", "", "any", 20)).unwrap();
        assert!(!names.is_empty());
        for n in &names {
            assert_eq!(n.gender, "female");
            assert!(n.given.starts_with('芷'));
        }
        let names = generate_inner(&req("any", "", "岚", "any", 20)).unwrap();
        assert!(!names.is_empty());
        for n in &names {
            assert!(n.given.contains('岚'));
        }
    }

    #[test]
    fn obscurity_switches_pools_and_validation_rejects_garbage() {
        let rare = generate_inner(&req("any", "", "", "rare", 30)).unwrap();
        assert!(rare.iter().all(|n| n.rare));
        let common = generate_inner(&req("any", "", "", "common", 30)).unwrap();
        assert!(common.iter().all(|n| !n.rare));
        // 同种子可复现
        let a = generate_inner(&req("male", "", "", "any", 10)).unwrap();
        let b = generate_inner(&req("male", "", "", "any", 10)).unwrap();
        assert_eq!(a.iter().map(|n| &n.full).collect::<Vec<_>>(), b.iter().map(|n| &n.full).collect::<Vec<_>>());
        // 非法参数
        assert!(generate_inner(&req("robot", "", "", "any", 10)).is_err());
        assert!(generate_inner(&req("any", "", "", "weird", 10)).is_err());
        assert!(generate_inner(&req("any", "", "", "any", 0)).is_err());
        assert!(generate_inner(&req("any", "", "", "any", 51)).is_err());
        assert!(generate_inner(&req("any", "ab", "", "any", 10)).is_err());
        // 约束极紧：允许少返回，不 panic
        let tight = generate_inner(&req("female", "黛", "", "rare", 50)).unwrap();
        assert!(!tight.is_empty());
        assert!(tight.iter().all(|n| n.given.starts_with('黛') && n.rare));
    }
}
