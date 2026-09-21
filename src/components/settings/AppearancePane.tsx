// 外观设置面板：主题卡片网格（mini 预览随主题变量渲染）/ 明暗三选 / UI 缩放滑条 / 正文排版 / 纸张纹理。
// 所有改动即时生效（主题与明暗立即落盘，缩放防抖落盘）。
import { CSSProperties } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEMES } from "../../themes/defs";
import { TEXTURES } from "../../themes/textures";
import {
  AppearanceMode,
  PROSE_LETTER_SPACING_MAX,
  PROSE_LETTER_SPACING_MIN,
  PROSE_LETTER_SPACING_STEP,
  PROSE_LINE_HEIGHT_MAX,
  PROSE_LINE_HEIGHT_MIN,
  PROSE_LINE_HEIGHT_STEP,
  PROSE_PARA_SPACING_MAX,
  PROSE_PARA_SPACING_MIN,
  PROSE_PARA_SPACING_STEP,
  TEXTURE_OPACITY_MAX,
  TEXTURE_OPACITY_MIN,
  TEXTURE_OPACITY_STEP,
  TEXTURE_SCALE_MAX,
  TEXTURE_SCALE_MIN,
  TEXTURE_SCALE_STEP,
  TextureBlend,
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

const TEXTURE_BLENDS: { id: TextureBlend; label: string }[] = [
  { id: "soft-light", label: "柔光" },
  { id: "normal", label: "正常" },
  { id: "multiply", label: "正片叠底" },
  { id: "overlay", label: "叠加" },
];

function SectionTitle(props: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs text-[color:var(--text-faint)]">{props.children}</div>;
}

export function AppearancePane() {
  const colorTheme = useAppearance((s) => s.colorTheme);
  const mode = useAppearance((s) => s.mode);
  const uiScale = useAppearance((s) => s.uiScale);
  const prose = useAppearance((s) => s.prose);
  const texture = useAppearance((s) => s.texture);
  const setColorTheme = useAppearance((s) => s.setColorTheme);
  const setMode = useAppearance((s) => s.setMode);
  const setUiScale = useAppearance((s) => s.setUiScale);
  const setProse = useAppearance((s) => s.setProse);
  const setTexture = useAppearance((s) => s.setTexture);

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
                className={`rounded-[var(--radius-md)] border p-3 text-left transition-colors duration-[var(--dur-md)] ${
                  active
                    ? "border-[color:var(--accent)] bg-[var(--accent-dim)]"
                    : "border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]"
                }`}
              >
                {/* mini 预览：面板底 + 标题/正文示例 + 三个色块 */}
                <div
                  style={{ ...t.vars } as unknown as CSSProperties}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] p-2"
                >
                  <div className="mb-0.5 text-xs font-medium text-[var(--text-primary)]">章节标题</div>
                  <div className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
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
            aria-label="界面缩放"
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

      {/* 正文排版（M3-T11）：只作用于编辑器正文，UI 其它区域不受影响 */}
      <section>
        <SectionTitle>正文排版</SectionTitle>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm text-[color:var(--text-primary)]">段首缩进两字</span>
          <button
            role="switch"
            aria-checked={prose.indent}
            onClick={() => setProse({ indent: !prose.indent })}
            className={`relative h-5 w-9 rounded-full transition-colors duration-150 ${
              prose.indent ? "bg-[var(--accent)]" : "bg-[var(--bg-elevated)]"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-150 ${
                prose.indent ? "left-[1.125rem]" : "left-0.5"
              }`}
            />
          </button>
        </div>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm text-[color:var(--text-secondary)]">行高</span>
            <input
              type="range"
              aria-label="行高"
              min={PROSE_LINE_HEIGHT_MIN}
              max={PROSE_LINE_HEIGHT_MAX}
              step={PROSE_LINE_HEIGHT_STEP}
              value={prose.lineHeight}
              onChange={(e) => setProse({ lineHeight: Number(e.target.value) })}
              className="h-1 flex-1 accent-[var(--accent)]"
            />
            <span className="w-12 shrink-0 text-right text-sm tabular-nums text-[color:var(--text-primary)]">
              {prose.lineHeight.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm text-[color:var(--text-secondary)]">段距</span>
            <input
              type="range"
              aria-label="段距"
              min={PROSE_PARA_SPACING_MIN}
              max={PROSE_PARA_SPACING_MAX}
              step={PROSE_PARA_SPACING_STEP}
              value={prose.paraSpacing}
              onChange={(e) => setProse({ paraSpacing: Number(e.target.value) })}
              className="h-1 flex-1 accent-[var(--accent)]"
            />
            <span className="w-12 shrink-0 text-right text-sm tabular-nums text-[color:var(--text-primary)]">
              {prose.paraSpacing.toFixed(1)}em
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm text-[color:var(--text-secondary)]">字距</span>
            <input
              type="range"
              aria-label="字距"
              min={PROSE_LETTER_SPACING_MIN}
              max={PROSE_LETTER_SPACING_MAX}
              step={PROSE_LETTER_SPACING_STEP}
              value={prose.letterSpacing}
              onChange={(e) => setProse({ letterSpacing: Number(e.target.value) })}
              className="h-1 flex-1 accent-[var(--accent)]"
            />
            <span className="w-12 shrink-0 text-right text-sm tabular-nums text-[color:var(--text-primary)]">
              {prose.letterSpacing.toFixed(2)}em
            </span>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-[color:var(--text-faint)]">
          仅作用于编辑器正文；分场线显示为居中 ❖ 符号。
        </p>
      </section>

      {/* 纸张纹理（M3-T3）：整页覆盖底纹；选「无」时参数区隐藏（Maple 条件显隐约定） */}
      <section>
        <SectionTitle>纸张纹理</SectionTitle>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TEXTURES.map((t) => {
            const active = texture.preset === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTexture({ preset: t.id })}
                className={`rounded-full border px-3 py-1 text-sm transition-colors duration-150 ${
                  active
                    ? "border-[color:var(--accent)] bg-[var(--accent-dim)] text-[color:var(--accent)]"
                    : "border-[color:var(--border-subtle)] text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
                }`}
              >
                {t.name}
              </button>
            );
          })}
        </div>
        {texture.preset !== "none" && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-sm text-[color:var(--text-secondary)]">强度</span>
              <input
                type="range"
                aria-label="纹理强度"
                min={TEXTURE_OPACITY_MIN}
                max={TEXTURE_OPACITY_MAX}
                step={TEXTURE_OPACITY_STEP}
                value={texture.opacity}
                onChange={(e) => setTexture({ opacity: Number(e.target.value) })}
                className="h-1 flex-1 accent-[var(--accent)]"
              />
              <span className="w-12 shrink-0 text-right text-sm tabular-nums text-[color:var(--text-primary)]">
                {texture.opacity.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-sm text-[color:var(--text-secondary)]">缩放</span>
              <input
                type="range"
                aria-label="纹理缩放"
                min={TEXTURE_SCALE_MIN}
                max={TEXTURE_SCALE_MAX}
                step={TEXTURE_SCALE_STEP}
                value={texture.scale}
                onChange={(e) => setTexture({ scale: Number(e.target.value) })}
                className="h-1 flex-1 accent-[var(--accent)]"
              />
              <span className="w-12 shrink-0 text-right text-sm tabular-nums text-[color:var(--text-primary)]">
                {texture.scale.toFixed(1)}×
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-sm text-[color:var(--text-secondary)]">混合</span>
              <select
                aria-label="混合模式"
                value={texture.blend}
                onChange={(e) => setTexture({ blend: e.target.value as TextureBlend })}
                className="h-8 flex-1 rounded border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 text-sm text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
              >
                {TEXTURE_BLENDS.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        <p className="mt-1.5 text-xs text-[color:var(--text-faint)]">
          铺满整个界面的纸感底纹；强度建议 0.06–0.25，柔光模式深浅主题皆宜。
        </p>
      </section>
    </div>
  );
}
