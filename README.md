# 笔仙 Bixian

本地优先的 Rust 桌面 AI 长篇小说创作工具。人写为主、AI 辅助；人物图谱、伏笔追踪、灵感碰撞。

## 开发

    pnpm install
    pnpm tauri dev      # 开发运行（首次编译 Rust 约 2-5 分钟）
    pnpm test           # 前端测试
    cd src-tauri && cargo test   # Rust 测试
    pnpm tauri build    # 打包

## 数据位置

正文 markdown：`%APPDATA%/com.bixian.app/library/<书>/manuscript/*.md`（唯一真源，可随时用侧栏「重建索引」恢复数据库）。

设计文档：`docs/specs/2026-09-19-bixian-spec.md`；当前里程碑计划：`docs/superpowers/plans/`。
