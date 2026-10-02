// 调试版应用启停（核验前重编 Rust 时用：exe 运行中会被锁住）。
// 用法：node scripts/verify/app.mjs stop | start | restart | recover
//   recover：上一次核验中途崩溃没清场时，按落盘快照补做还原（下一次 withGuard 开始时也会自动做）
import { connect, recoverPending, startApp, stopApp } from "./lib.mjs";

const cmd = process.argv[2] ?? "restart";
if (cmd === "stop" || cmd === "restart") await stopApp();
if (cmd === "start" || cmd === "restart") await startApp();
if (cmd === "recover") {
  const app = await connect();
  console.log((await recoverPending(app)) ? "已按快照还原" : "没有未清场的核验");
  app.close();
}
console.log(`bixian ${cmd} 完成`);
