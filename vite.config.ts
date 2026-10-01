/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: "./src/test-setup.ts",
    // 多核机器上默认并发（核数 − 1）个 worker 同时冷启动 happy-dom，慢盘上会「worker 启动超时」，
    // npm test 偶发非零退出（与用例无关）。限制并发换稳定。
    maxWorkers: 8,
  },
});
