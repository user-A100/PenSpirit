// 调试版应用启停（核验前重编 Rust 时用：exe 运行中会被锁住）。
// 用法：node scripts/verify/app.mjs stop | start | restart
import { startApp, stopApp } from "./lib.mjs";

const cmd = process.argv[2] ?? "restart";
if (cmd === "stop" || cmd === "restart") await stopApp();
if (cmd === "start" || cmd === "restart") await startApp();
console.log(`bixian ${cmd} 完成`);
