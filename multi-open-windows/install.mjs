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
try { execFileSync("node", ["--version"], { stdio: "ignore" }); } catch {
  fail("未安装 Node.js。请运行: winget install OpenJS.NodeJS.LTS 后重试");
}
// 主安装目录动态检测：OMB_PRIMARY_DIR > 运行进程 > 注册表 > 常见路径 > 桌面快捷方式
function detectPrimaryExe() {
  if (process.env.OMB_PRIMARY_DIR) {
    const p = path.join(path.resolve(process.env.OMB_PRIMARY_DIR), "OpenMausBot.exe");
    if (fs.existsSync(p)) return p;
  }
  const exists = (p) => { try { return !!p && fs.existsSync(p); } catch { return false; } };
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command",
      "Get-Process OpenMausBot -ErrorAction SilentlyContinue | Where-Object { $_.Path -notlike '*OpenMausBot-Multi*' } | Select-Object -First 1 -ExpandProperty Path"],
      { encoding: "utf8", timeout: 20000 });
    const p = (out ?? "").trim();
    if (exists(p)) return p;
  } catch {}
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command",
      "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*OpenMausBot*' } | Select-Object -First 1 -ExpandProperty InstallLocation"],
      { encoding: "utf8", timeout: 20000 });
    const dir = (out ?? "").trim();
    if (exists(dir && path.join(dir, "OpenMausBot.exe"))) return path.join(dir, "OpenMausBot.exe");
  } catch {}
  for (const dir of [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "openmausbot"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "openmausbot"),
  ]) {
    if (exists(dir && path.join(dir, "OpenMausBot.exe"))) return path.join(dir, "OpenMausBot.exe");
  }
  return null;
}
const primary = detectPrimaryExe();
if (!primary) fail("未找到 OpenMausBot 桌面版（已检测运行进程/注册表/常见路径）。请先安装客户端，或设环境变量 OMB_PRIMARY_DIR 指向安装目录");
console.log("[install] 主安装: " + primary);

// 2. 拷贝工具文件
const FILES = ["build-multi.mjs", "open-multi.mjs", "OpenMausBot-Multi.cmd", "set-count.cmd"];
fs.mkdirSync(TOOLS, { recursive: true });
for (const f of FILES) {
  const src = path.join(HERE, f);
  if (!fs.existsSync(src)) fail(`安装包缺少文件 ${f}（请完整下载 multi-open-windows 目录）`);
  fs.copyFileSync(src, path.join(TOOLS, f));
}
console.log("[install] 工具文件已就位: " + TOOLS);

// 3. 桌面入口：直接落 .cmd 文件（.lnk 快捷方式在某些机器会静默丢失，实测）
const desk = path.join(HOME, "Desktop");
if (!fs.existsSync(desk)) fail(`桌面目录不存在: ${desk}`);
try {
  fs.copyFileSync(path.join(TOOLS, "OpenMausBot-Multi.cmd"), path.join(desk, "BSCBot-多开.cmd"));
  fs.copyFileSync(path.join(TOOLS, "set-count.cmd"), path.join(desk, "BSCBot-多开-设置数量.cmd"));
  console.log("[install] 桌面已创建: BSCBot-多开.cmd / BSCBot-多开-设置数量.cmd");
} catch (e) {
  console.log("[install] 桌面文件创建失败（可手动从 " + TOOLS + " 复制两个 .cmd 到桌面）: " + e.message?.slice(0, 100));
}

console.log(`
[install] 完成！使用方法：
  双击桌面「OpenMausBot-多开」→ 首次弹窗问每批数量（建议 3）→ 每点一次新增打开一批
  每个客户端是独立工作区（首次进入走 onboarding，可分别配对不同服务器）
  改每批数量：双击「OpenMausBot-多开-设置数量」
  首次点击会构建副本（约1分钟），之后秒开；主安装升级后自动跟随重建
`);
