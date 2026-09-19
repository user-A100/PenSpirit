// 外观设置面板：主题卡片网格（mini 预览随主题变量渲染）/ 明暗三选 / UI 缩放滑条。
// 所有改动即时生效（主题与明暗立即落盘，缩放防抖落盘）。
import { CSSProperties } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEMES } from "../../themes/defs";
import {
  AppearanceMode,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  useAppearance,
} from "../../themes/ThemeProvider";

const MODES: { id: AppearanceMode; label: string; icon: typeof Monitor }[] = [
  { id: "system", label: "跟随系统", icon: Monitor },
  { id: "light", label: "浅色", icon: Sun },
  { id: "dark", label: "深色", icon: Moon },
];

function SectionTitle(props: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs text-[color:var(--text-faint)]">{props.children}</div>;
}

export function AppearancePane() {
  const colorTheme = useAppearance((s) => s.colorTheme);
  const mode = useAppearance((s) => s.mode);
  const uiScale = useAppearance((s) => s.uiScale);
  const setColorTheme = useAppearance((s) => s.setColorTheme);
  const setMode = useAppearance((s) => s.setMode);
  const setUiScale = useAppearance((s) => s.setUiScale);

  return (
    <div className="flex flex-col gap-5">
      {/* 主题：卡片 mini 预览内联注入该主题变量，与当前激活主题无关 */}
      <section>
        <SectionTitle>配色主题</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          {THEMES.map((t) => {
            const active = t.id === colorTheme;
            return (
              <button
                key={t.id}
                onClick={() => setColorTheme(t.id)}
                className={`rounded-lg border p-2.5 text-left transition-colors duration-150 ${
                  active
                    ? "border-[color:var(--accent)] bg-[var(--accent-dim)]"
                    : "border-[color:var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {/* mini 预览：面板底 + 标题/正文示例 + 三个色块 */}
                <div
                  style={{ ...t.vars } as unknown as CSSProperties}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2"
                >
                  <div className="mb-0.5 text-xs font-medium text-[var(--text-primary)]">章节标题</div>
                  <div className="text-[10px] leading-relaxed text-[var(--text-secondary)]">
                    山雨欲来风满楼，正是落笔时。
                  </div>
                  <div className="mt-1.5 flex items-center gap-1">
                    <span className="h-2.5 w-5 rounded-[2px] bg-[var(--accent)]" />
                    <span className="h-2.5 w-5 rounded-[2px] bg-[var(--bg-elevated)]" />
                    <span className="h-2.5 w-5 rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-hover)]" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-1">
                  <span className="truncate text-sm text-[color:var(--text-primary)]">{t.name}</span>
                  {active ? (
                    <span className="shrink-0 rounded-full bg-[var(--accent-dim)] px-2 py-0.5 text-xs text-[color:var(--accent)]">
                      使用中
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-[color:var(--text-faint)]">
                      {t.dark ? "深色" : "浅色"}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 明暗：与配色主题正交，仅控制界面明暗属性（跟随系统时随 OS 自动切换） */}
      <section>
        <SectionTitle>界面明暗</SectionTitle>
        <div className="flex rounded-md border border-[color:var(--border-subtle)] p-0.5">
          {MODES.map((m) => {
            const active = mode === m.id;
            const Icon = m.icon;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-sm transition-colors duration-150 ${
                  active
                    ? "bg-[var(--accent-dim)] text-[color:var(--accent)]"
                    : "text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
                }`}
              >
                <Icon size={14} />
                {m.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-[color:var(--text-faint)]">
          明暗与配色主题相互独立；主题自身的明暗倾向见卡片角标。
        </p>
      </section>

      {/* UI 缩放：拖动实时生效，落盘防抖 */}
      <section>
        <SectionTitle>界面缩放</SectionTitle>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={UI_SCALE_STEP}
            value={uiScale}
            onChange={(e) => setUiScale(Number(e.target.value))}
            className="h-1 flex-1 accent-[var(--accent)]"
          />
          <span className="w-12 shrink-0 text-right text-sm tabular-nums text-[color:var(--text-primary)]">
            {Math.round(uiScale * 100)}%
          </span>
        </div>
        <p className="mt-1.5 text-xs text-[color:var(--text-faint)]">
          80%–150%，实时生效。文字与间距随缩放；图标、固定栏宽等少量像素尺寸不随缩放。
        </p>
      </section>
    </div>
  );
}
