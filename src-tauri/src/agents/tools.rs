//! Agent 工具调用的精简视图（阶段 2B）：把 ACP 的 ToolCall / ToolCallUpdate 折成
//! {标题, 类别, 状态, 涉及文件, 增删行数}，供对话里折叠展示；回合结束随回答一起落进 meta。

use std::collections::HashMap;
use std::path::Path;

use agent_client_protocol::schema::v1::{ToolCall, ToolCallContent, ToolCallStatus, ToolCallUpdate, ToolKind};

use crate::models::AgentToolEntry;

pub fn kind_str(k: &ToolKind) -> &'static str {
    match k {
        ToolKind::Read => "read",
        ToolKind::Edit => "edit",
        ToolKind::Delete => "delete",
        ToolKind::Move => "move",
        ToolKind::Search => "search",
        ToolKind::Execute => "execute",
        ToolKind::Think => "think",
        ToolKind::Fetch => "fetch",
        ToolKind::SwitchMode => "switch_mode",
        _ => "other",
    }
}

pub fn status_str(s: &ToolCallStatus) -> &'static str {
    match s {
        ToolCallStatus::InProgress => "in_progress",
        ToolCallStatus::Completed => "completed",
        ToolCallStatus::Failed => "failed",
        _ => "pending",
    }
}

/// 在书目录下的路径给相对路径（正斜杠），否则原样
pub fn rel_path(cwd: &Path, p: &Path) -> String {
    p.strip_prefix(cwd).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

/// 增删行数（按行多重集近似，够做「+12 −3」提示）
pub fn diff_stats(old: Option<&str>, new: &str) -> (i64, i64) {
    let mut count: HashMap<&str, i64> = HashMap::new();
    for l in old.unwrap_or("").lines() {
        *count.entry(l).or_default() += 1;
    }
    let mut added = 0;
    for l in new.lines() {
        match count.get_mut(l) {
            Some(n) if *n > 0 => *n -= 1,
            _ => added += 1,
        }
    }
    (added, count.values().sum())
}

fn push_path(e: &mut AgentToolEntry, p: String) {
    if !e.paths.contains(&p) {
        e.paths.push(p);
    }
}

fn absorb_content(e: &mut AgentToolEntry, content: &[ToolCallContent], cwd: &Path) {
    let (mut added, mut removed, mut any) = (0, 0, false);
    for c in content {
        if let ToolCallContent::Diff(d) = c {
            push_path(e, rel_path(cwd, &d.path));
            let (a, r) = diff_stats(d.old_text.as_deref(), &d.new_text);
            added += a;
            removed += r;
            any = true;
        }
    }
    if any {
        e.added = added;
        e.removed = removed;
    }
}

fn upsert(list: &mut Vec<AgentToolEntry>, e: AgentToolEntry) {
    match list.iter_mut().find(|x| x.id == e.id) {
        Some(x) => *x = e,
        None => list.push(e),
    }
}

/// 新的工具调用（同 id 再来视为整体替换）
pub fn on_tool_call(list: &mut Vec<AgentToolEntry>, tc: &ToolCall, cwd: &Path) -> AgentToolEntry {
    let mut e = AgentToolEntry {
        id: tc.tool_call_id.to_string(),
        title: tc.title.clone(),
        kind: kind_str(&tc.kind).into(),
        status: status_str(&tc.status).into(),
        ..Default::default()
    };
    for l in &tc.locations {
        push_path(&mut e, rel_path(cwd, &l.path));
    }
    absorb_content(&mut e, &tc.content, cwd);
    upsert(list, e.clone());
    e
}

/// 工具调用的增量更新（未见过的 id 也接住）
pub fn on_tool_update(list: &mut Vec<AgentToolEntry>, u: &ToolCallUpdate, cwd: &Path) -> AgentToolEntry {
    let id = u.tool_call_id.to_string();
    let mut e = list.iter().find(|x| x.id == id).cloned().unwrap_or_else(|| AgentToolEntry {
        id: id.clone(),
        title: "工具调用".into(),
        kind: "other".into(),
        status: "pending".into(),
        ..Default::default()
    });
    let f = &u.fields;
    if let Some(k) = &f.kind {
        e.kind = kind_str(k).into();
    }
    if let Some(s) = &f.status {
        e.status = status_str(s).into();
    }
    if let Some(t) = &f.title {
        e.title = t.clone();
    }
    if let Some(ls) = &f.locations {
        for l in ls {
            push_path(&mut e, rel_path(cwd, &l.path));
        }
    }
    if let Some(c) = &f.content {
        absorb_content(&mut e, c, cwd);
    }
    upsert(list, e.clone());
    e
}
