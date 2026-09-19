import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initAppearanceSync } from "./themes/ThemeProvider";
import "./styles.css";

// 防闪烁：渲染前同步应用外观（主题/明暗/缩放），读 localStorage 缓存，无异步等待
initAppearanceSync();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
