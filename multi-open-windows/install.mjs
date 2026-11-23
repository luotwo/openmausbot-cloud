#!/usr/bin/env node
// OpenMausBot 多开一键安装（Windows）
// 前提：① 已安装 OpenMausBot 桌面版（默认路径）② 已安装 Node.js（winget install OpenJS.NodeJS.LTS）
// 做的事：拷贝多开工具 → 创建桌面快捷方式「OpenMausBot-多开」「OpenMausBot-多开-设置数量」
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOLS = path.join(process.env.USERPROFILE ?? "", ".openmausbot", "multi-instance");
const HOME = process.env.USERPROFILE ?? "";
const fail = (m) => { console.error("[install] 失败: " + m); process.exit(2); };

// 1. 前提检查
const primary = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "openmausbot", "OpenMausBot.exe");
if (!fs.existsSync(primary)) fail(`未找到 OpenMausBot 桌面版（${primary}）。请先安装客户端再运行本安装器`);
try { execFileSync("node", ["--version"], { stdio: "ignore" }); } catch {
  fail("未安装 Node.js。请运行: winget install OpenJS.NodeJS.LTS 后重试");
}

// 2. 拷贝工具文件
const FILES = ["build-multi.mjs", "open-multi.mjs", "OpenMausBot-Multi.cmd", "set-count.cmd"];
fs.mkdirSync(TOOLS, { recursive: true });
for (const f of FILES) {
  const src = path.join(HERE, f);
  if (!fs.existsSync(src)) fail(`安装包缺少文件 ${f}（请完整下载 multi-open-windows 目录）`);
  fs.copyFileSync(src, path.join(TOOLS, f));
}
console.log("[install] 工具文件已就位: " + TOOLS);

// 3. 桌面快捷方式
const shortcut = (name, target, args) => {
  const ps = [
    "$ws = New-Object -ComObject WScript.Shell",
    `$desk = [Environment]::GetFolderPath('Desktop')`,
    `$s = $ws.CreateShortcut("$desk\\${name}")`,
    `$s.TargetPath = '${target}'`,
    `$s.Arguments = '${args}'`,
    `$s.WorkingDirectory = '${TOOLS.replace(/'/g, "''")}'`,
    "$s.Save()",
  ];
  execFileSync("powershell", ["-NoProfile", "-Command", ps.join("; ")], { stdio: "ignore" });
};
try {
  shortcut("OpenMausBot-多开.lnk", path.join(TOOLS, "OpenMausBot-Multi.cmd"), "");
  shortcut("OpenMausBot-多开-设置数量.lnk", path.join(TOOLS, "set-count.cmd"), "");
  console.log("[install] 桌面快捷方式已创建");
} catch (e) {
  console.log("[install] 快捷方式创建失败（可手动双击 " + path.join(TOOLS, "OpenMausBot-Multi.cmd") + "）: " + e.message?.slice(0, 100));
}

console.log(`
[install] 完成！使用方法：
  双击桌面「OpenMausBot-多开」→ 首次弹窗问每批数量（建议 3）→ 每点一次新增打开一批
  每个客户端是独立工作区（首次进入走 onboarding，可分别配对不同服务器）
  改每批数量：双击「OpenMausBot-多开-设置数量」
  首次点击会构建副本（约1分钟），之后秒开；主安装升级后自动跟随重建
`);
