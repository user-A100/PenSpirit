// 导入设置面板（M4-T2）：自定义分章正则的增删改。
// 规则存 settings 表 customChapterRules 键（JSON 数组），Rust 侧 load_custom_rules
// 读取编译后叠加进内置分章规则（guard 先判，规则只加覆盖）；改动即时落库。
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../../lib/tauri";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

const KEY = "customChapterRules";
/// 上限与 Rust 侧 CUSTOM_RULES_MAX / CUSTOM_RULE_PATTERN_MAX 对齐
const RULES_MAX = 20;
const PATTERN_MAX = 200;

interface Rule {
  name: string;
  pattern: string;
}

function SectionTitle(props: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs text-[color:var(--text-faint)]">{props.children}</div>;
}

export function ImportPane() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [err, setErr] = useState("");

  // 已存规则回显（坏 JSON / 非数组当作无规则，不炸设置页）
  useEffect(() => {
    api.settingGet(KEY).then((raw) => {
      if (!raw) return;
      try {
        const list = JSON.parse(raw) as Rule[];
        if (Array.isArray(list)) {
          setRules(list.filter((r) => r && typeof r.name === "string" && typeof r.pattern === "string"));
        }
      } catch {
        /* 坏 JSON 当作无规则 */
      }
    });
  }, []);

  const persist = (next: Rule[]) => {
    setRules(next);
    api.settingSet(KEY, JSON.stringify(next));
  };

  const add = () => {
    setErr("");
    const n = name.trim();
    const p = pattern.trim();
    if (!n || !p) {
      setErr("规则名与正则都不能为空");
      return;
    }
    if (rules.length >= RULES_MAX) {
      setErr(`最多 ${RULES_MAX} 条规则`);
      return;
    }
    if (p.length > PATTERN_MAX) {
      setErr(`正则最长 ${PATTERN_MAX} 字符`);
      return;
    }
    try {
      new RegExp(p);
    } catch {
      setErr("正则无效，请检查语法");
      return;
    }
    persist([...rules, { name: n, pattern: p }]);
    setName("");
    setPattern("");
  };

  return (
    <div className="flex flex-col gap-5">
      {/* 规则列表：行内可直接改名/改正则，改动即时落库 */}
      <section>
        <SectionTitle>自定义分章规则</SectionTitle>
        <div className="flex flex-col gap-1.5">
          {rules.length === 0 && (
            <div className="rounded-md border border-[color:var(--border-subtle)] px-2.5 py-3 text-center text-xs text-[color:var(--text-faint)]">
              暂无自定义规则；内置已识别「第X章 / 卷X / 1.标题 / Chapter 1」等常见格式
            </div>
          )}
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label="规则名"
                value={r.name}
                className="w-24 shrink-0"
                onChange={(e) => persist(rules.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <Input
                aria-label="正则"
                value={r.pattern}
                className="flex-1 font-mono"
                onChange={(e) => persist(rules.map((x, j) => (j === i ? { ...x, pattern: e.target.value } : x)))}
              />
              <button
                title="删除"
                onClick={() => persist(rules.filter((_, j) => j !== i))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 新增：规则名 + 正则 + 添加 */}
      <section>
        <SectionTitle>新增规则</SectionTitle>
        {err && (
          <div className="mb-2 rounded-md border border-[color:var(--danger)] px-2.5 py-1.5 text-xs text-[color:var(--danger)]">
            {err}
          </div>
        )}
        <div className="grid grid-cols-[6rem_1fr_auto] gap-2">
          <Input placeholder="规则名" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="如：^【.+】$" value={pattern} onChange={(e) => setPattern(e.target.value)} />
          <Button variant="primary" onClick={add}>
            添加
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-[color:var(--text-faint)]">
          行内命中即视为章题行（仍受「句读结尾 / 40 字上限」防误切保护）；对 txt / docx 的导入预览与落库同时生效。
        </p>
      </section>
    </div>
  );
}
