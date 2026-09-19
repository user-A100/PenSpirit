# 笔仙 Bixian

本地优先的 Rust 桌面 AI 长篇小说创作工具。人写为主、AI 辅助；人物图谱、伏笔追踪、灵感碰撞。

## M1 功能

- **服务商配置**：设置 → AI 服务商，填 API 地址 / Key / 模型 / 最大 Token / 温度；「设为使用中」切换当前服务商。
- **流式续写**：AI 续写面板输入写作指令，Enter 发送、Shift+Enter 换行；流式渲染可随时「停止」，满意后「采纳进正文」。
- **文风库**：维护文风卡（提示词 + 范例 + 标签），按书指定激活文风，续写时自动注入。
- **上下文预览**：面板顶栏「预览」摊开本次续写的全部注入槽位（默认提示 / 文风 / 上一章结尾 / 当前章正文 / 写作指令），逐槽显示字数与估算 token——所有注入可见，无黑盒。

## 配置 API

1. 准备一个 OpenAI 兼容的 `/chat/completions` 服务（DeepSeek、OpenAI、本地 Ollama 等均可）。
2. 打开「设置 → AI 服务商 → 新增服务商」，填写：
   - **API 地址**：到 `/v1` 为止，如 `https://api.deepseek.com/v1`（须以 http 开头）
   - **API Key**、**模型**：如 `deepseek-chat`
   - **最大 Token / 温度**：可选，默认 4096 / 0.7
3. 保存后点「设为使用中」，该服务商即用于 AI 续写。

## 开发

    pnpm install
    pnpm tauri dev      # 开发运行（首次编译 Rust 约 2-5 分钟）
    pnpm test           # 前端测试
    cd src-tauri && cargo test   # Rust 测试
    pnpm tauri build    # 打包

## 数据位置

- 正文 markdown：`%APPDATA%/com.bixian.app/library/<书>/manuscript/*.md`（唯一真源，可随时用侧栏「重建索引」恢复数据库）。
- 数据库（书 / 章节索引 / 服务商 / 文风卡 / 会话与消息）：`%APPDATA%/com.bixian.app/bixian.db`。

设计文档：`docs/specs/2026-09-19-bixian-spec.md`；当前里程碑计划：`docs/superpowers/plans/`。
