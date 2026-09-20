import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Search, X } from "lucide-react";
import { api } from "../../lib/tauri";
import type { BgImage } from "../../lib/tauri";
import { READING_BG_PRESETS, useReadingPrefs } from "./readingPrefs";

// 右侧阅读设置面板（M3-T6，books-reader SettingPanel 简化移植）：
// 分区带 data-search-key，顶部搜索框按标题打分（整词 1000 / 前缀 900 / 子序列 100），
// 命中后 scrollIntoView + .setting-hit 高亮 1.8s（动画在 styles.css）。
// 滑条/色圈直写 readingPrefs store（localStorage 即时落盘，ReadView 即时消费）。
// 面板常驻挂载在 ReadingShell 右栏——input 聚焦守卫由壳层 onFocus/onBlur 负责。

const FONT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "默认衬线" },
  { value: "kai", label: "楷体" },
  { value: "song", label: "宋体" },
  { value: "hei", label: "黑体" },
];

/** 设置搜索索引：key = 分区 data-search-key */
const SEARCH_INDEX: { key: string; title: string }[] = [
  { key: "colors", title: "配色" },
  { key: "bgimage", title: "背景图" },
  { key: "typography", title: "排版" },
  { key: "font", title: "字体与对齐" },
];

const HIT_MS = 1800;

/** query 是否为 text 的子序列（保序） */
function isSubsequence(query: string, text: string): boolean {
  let i = 0;
  for (const ch of text) {
    if (i < query.length && ch === query[i]) i++;
  }
  return i === query.length;
}

/** 标题打分：整词 1000 / 前缀 900 / 子序列 100；不命中回 -1 */
function scoreTitle(query: string, title: string): number {
  if (query === title) return 1000;
  if (title.startsWith(query)) return 900;
  if (isSubsequence(query, title)) return 100;
  return -1;
}

/** 全索引取最高分分区 key；无命中回 null */
function bestSection(query: string): string | null {
  let bestKey: string | null = null;
  let bestScore = 0; // ≤0（不命中）不选
  for (const { key, title } of SEARCH_INDEX) {
    const s = scoreTitle(query, title);
    if (s > bestScore) {
      bestScore = s;
      bestKey = key;
    }
  }
  return bestKey;
}

function Section({ searchKey, title, children }: { searchKey: string; title: string; children: ReactNode }) {
  return (
    <section data-search-key={searchKey} className="rounded-lg px-1 py-3">
      <h3 className="pb-2 text-[11px] font-medium tracking-wider text-[var(--text-faint)]">{title}</h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

function SliderRow(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  const { label, min, max, step, value, onChange, fmt } = props;
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[11px] text-[var(--text-secondary)]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-[var(--accent)]"
      />
      <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-secondary)]">
        {fmt ? fmt(value) : value}
      </span>
    </div>
  );
}

export function SettingPanel() {
  const prefs = useReadingPrefs();
  const [query, setQuery] = useState("");
  const [images, setImages] = useState<BgImage[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hitTimer = useRef<number | undefined>(undefined);

  // 背景图列表（挂载拉取；导入/删除后刷新；选中项已不在列表则清引用）
  const refreshImages = useCallback(() => {
    api.readingBgList()
      .then((list) => {
        setImages(list);
        const cur = useReadingPrefs.getState().bgImage;
        if (cur != null && !list.some((i) => i.id === cur.id)) {
          useReadingPrefs.getState().set({ bgImage: null });
        }
      })
      .catch(() => setImages([]));
  }, []);
  useEffect(refreshImages, [refreshImages]);

  // 设置搜索：清旧高亮 → 最高分分区滚入 + 高亮 1.8s
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll(".setting-hit").forEach((el) => el.classList.remove("setting-hit"));
    window.clearTimeout(hitTimer.current);
    const q = query.trim();
    if (!q) return;
    const key = bestSection(q);
    if (!key) return;
    const el = root.querySelector(`[data-search-key="${key}"]`);
    if (!el) return;
    el.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    void (el as HTMLElement).offsetWidth; // 强制 reflow，连续输入也能重播动画
    el.classList.add("setting-hit");
    hitTimer.current = window.setTimeout(() => el.classList.remove("setting-hit"), HIT_MS);
    return () => window.clearTimeout(hitTimer.current);
  }, [query]);

  const onImport = async () => {
    const picked = await openFileDialog({
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (typeof picked !== "string" || picked.length === 0) return;
    try {
      await api.readingBgImport(picked);
      refreshImages();
    } catch (e) {
      console.error("背景图导入失败", e);
    }
  };

  const onDelete = async (img: BgImage) => {
    if (!window.confirm(`删除背景图「${img.name}」？`)) return;
    try {
      await api.readingBgDelete(img.id);
    } catch (e) {
      console.error("背景图删除失败", e);
      return;
    }
    refreshImages();
  };

  const onToggleImage = (img: BgImage) => {
    const cur = useReadingPrefs.getState().bgImage;
    prefs.set(cur?.id === img.id ? { bgImage: null } : { bgImage: { id: img.id, path: img.path } });
  };

  const segBtn = (active: boolean) =>
    `px-2.5 py-1 transition-colors ${
      active ? "bg-[var(--accent-dim)] text-[var(--accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
    }`;

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      {/* 搜索 */}
      <div className="flex items-center gap-2 px-4 pb-1 pt-4 pr-10">
        <Search size={14} className="shrink-0 opacity-50" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索设置…"
          className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1 text-xs outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {/* 配色 */}
        <Section searchKey="colors" title="配色">
          <div className="flex items-center gap-3">
            {READING_BG_PRESETS.map((p) => {
              const active = prefs.bgColor === p.bg && prefs.textColor === p.text;
              return (
                <button
                  key={p.name}
                  title={p.name}
                  aria-label={`配色预设 ${p.name}`}
                  onClick={() => prefs.set({ bgColor: p.bg, textColor: p.text })}
                  className={`h-7 w-7 rounded-full border transition-transform hover:scale-110 ${
                    active
                      ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                      : "border-[var(--border-strong)]"
                  }`}
                  style={{ backgroundColor: p.bg }}
                />
              );
            })}
          </div>
          <div className="flex items-center gap-4 text-[11px] text-[var(--text-secondary)]">
            <label className="flex items-center gap-1.5">
              底色
              <input
                type="color"
                aria-label="自定义底色"
                value={prefs.bgColor}
                onChange={(e) => prefs.set({ bgColor: e.target.value })}
                className="h-6 w-8 cursor-pointer rounded border border-[var(--border-subtle)] bg-transparent p-0"
              />
            </label>
            <label className="flex items-center gap-1.5">
              文字
              <input
                type="color"
                aria-label="自定义文字色"
                value={prefs.textColor}
                onChange={(e) => prefs.set({ textColor: e.target.value })}
                className="h-6 w-8 cursor-pointer rounded border border-[var(--border-subtle)] bg-transparent p-0"
              />
            </label>
          </div>
          <p className="text-[10px] text-[var(--text-faint)]">深色底建议搭配浅色文字</p>
        </Section>

        {/* 背景图 */}
        <Section searchKey="bgimage" title="背景图">
          <button
            onClick={() => void onImport()}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--border-strong)] py-2 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
          >
            <ImagePlus size={14} />
            导入图片（png/jpg/webp/gif，≤10MB）
          </button>
          {images.length === 0 && (
            <p className="text-[10px] text-[var(--text-faint)]">还没有背景图，导入一张试试</p>
          )}
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {images.map((img) => {
                const active = prefs.bgImage?.id === img.id;
                return (
                  <div key={img.id} className="group relative">
                    <button
                      title={active ? `${img.name}（点击取消）` : `使用「${img.name}」`}
                      aria-label={`背景图 ${img.name}`}
                      onClick={() => onToggleImage(img)}
                      className={`block aspect-[4/3] w-full rounded-md border bg-cover bg-center ${
                        active
                          ? "border-[var(--accent)] ring-2 ring-[var(--accent)]"
                          : "border-[var(--border-subtle)]"
                      }`}
                      style={{ backgroundImage: `url(${convertFileSrc(img.path)})` }}
                    />
                    <button
                      title={`删除 ${img.name}`}
                      aria-label={`删除背景图 ${img.name}`}
                      onClick={() => void onDelete(img)}
                      className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {prefs.bgImage != null && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
              <span className="w-12 shrink-0">不透明度</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={prefs.bgOpacity}
                aria-label="背景图不透明度"
                onChange={(e) => prefs.set({ bgOpacity: Number(e.target.value) })}
                className="min-w-0 flex-1 accent-[var(--accent)]"
              />
              <span className="w-9 shrink-0 text-right tabular-nums">{prefs.bgOpacity}%</span>
            </div>
          )}
        </Section>

        {/* 排版 */}
        <Section searchKey="typography" title="排版">
          <SliderRow
            label="字号" min={13} max={40} step={1}
            value={prefs.fontSize}
            onChange={(v) => prefs.set({ fontSize: v })}
            fmt={(v) => `${v}px`}
          />
          <SliderRow
            label="行距" min={1.4} max={3} step={0.1}
            value={prefs.lineHeight}
            onChange={(v) => prefs.set({ lineHeight: v })}
          />
          <SliderRow
            label="字距" min={0} max={2} step={0.1}
            value={prefs.letterSpacing}
            onChange={(v) => prefs.set({ letterSpacing: v })}
            fmt={(v) => `${v}em`}
          />
          <SliderRow
            label="段距" min={0} max={3} step={0.1}
            value={prefs.paraSpacing}
            onChange={(v) => prefs.set({ paraSpacing: v })}
            fmt={(v) => `${v}em`}
          />
          <SliderRow
            label="页宽" min={480} max={1600} step={10}
            value={prefs.pageWidth}
            onChange={(v) => prefs.set({ pageWidth: v })}
            fmt={(v) => `${v}px`}
          />
          <SliderRow
            label="页边" min={0} max={96} step={1}
            value={prefs.margin}
            onChange={(v) => prefs.set({ margin: v })}
            fmt={(v) => `${v}px`}
          />
          <SliderRow
            label="留白" min={0} max={60} step={5}
            value={prefs.bottomSpace}
            onChange={(v) => prefs.set({ bottomSpace: v })}
            fmt={(v) => `${v}%`}
          />
        </Section>

        {/* 字体与对齐 */}
        <Section searchKey="font" title="字体与对齐">
          <label className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <span className="w-8 shrink-0">字体</span>
            <select
              aria-label="字体"
              value={prefs.fontFamily}
              onChange={(e) => prefs.set({ fontFamily: e.target.value })}
              className="min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-1.5 py-1 text-[11px] outline-none"
            >
              {FONT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <span className="w-8 shrink-0">对齐</span>
            <div className="flex overflow-hidden rounded-md border border-[var(--border-subtle)]">
              <button aria-label="左对齐" onClick={() => prefs.set({ textAlign: "left" })} className={segBtn(prefs.textAlign === "left")}>
                左
              </button>
              <button
                aria-label="两端对齐"
                onClick={() => prefs.set({ textAlign: "justify" })}
                className={segBtn(prefs.textAlign === "justify")}
              >
                两端
              </button>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <input
              type="checkbox"
              aria-label="首行缩进"
              checked={prefs.indent}
              onChange={(e) => prefs.set({ indent: e.target.checked })}
              className="accent-[var(--accent)]"
            />
            首行缩进两字
          </label>
        </Section>
      </div>
    </div>
  );
}
