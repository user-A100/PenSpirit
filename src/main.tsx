import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RefWindowApp } from "./components/reference/RefWindowApp";
import { initAppearanceSync } from "./themes/ThemeProvider";
import "./styles.css";

// 防闪烁：渲染前同步应用外观（主题/明暗/缩放），读 localStorage 缓存，无异步等待
initAppearanceSync();

// 参考浮窗（M7 批次7）：OS 层第二窗口加载同一 index.html，
// Rust 侧以 ?refwindow&book=&chapter= 区分用途，这里只挂轻量只读应用
const params = new URLSearchParams(window.location.search);
if (params.has("refwindow")) {
  const book = params.get("book");
  const chapter = params.get("chapter");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <RefWindowApp
        bookId={book != null && book !== "" ? Number(book) : null}
        initialChapterId={chapter != null && chapter !== "" ? Number(chapter) : null}
      />
    </React.StrictMode>,
  );
} else {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
