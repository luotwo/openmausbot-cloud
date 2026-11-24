#!/usr/bin/env node
// OpenMausBot 多开启动逻辑（全部在 node 里做，cmd 只调用本脚本）
// 升级安全设计：主安装永不改动、正常自动升级；
// 本脚本检测主安装 app.asar 指纹变化 → 自动重建副本 → 打 userData 分叉补丁 → 启动。
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

const PRIMARY = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "openmausbot");
// 副本目录：优先 OMB_COPY_DIR 覆盖 > 已有 OpenMausBot-Multi 的盘 > 第一个非 C 盘 > 用户目录
function pickCopyDir() {
  if (process.env.OMB_COPY_DIR) return path.join(process.env.OMB_COPY_DIR, "OpenMausBot-Multi");
  const letters = "DEFGHIJKLMNOPQRSTUVWXYZ".split("");
  for (const L of letters) {
    const p = `${L}:\\OpenMausBot-Multi`;
    if (fs.existsSync(p)) return p; // 已有副本的盘优先（保持数据位置稳定）
  }
  for (const L of letters) {
    if (fs.existsSync(`${L}:\\`)) return `${L}:\\OpenMausBot-Multi`;
  }
  return path.join(process.env.USERPROFILE ?? "", "OpenMausBot-Multi");
}
const COPY = pickCopyDir();
const ASAR = path.join(PRIMARY, "resources", "app.asar");
const STATE = path.join(COPY, "primary-app.asar.state");

const log = (m) => console.log("[multi] " + m);
const fail = (m) => { console.error("[multi] 失败: " + m); process.exit(2); };

function fingerprint() {
  const st = fs.statSync(ASAR);
  return `${st.size}_${Math.round(st.mtimeMs)}`;
}

// 1. 前置检查
if (!fs.existsSync(ASAR)) fail("未找到主安装 app.asar: " + ASAR);
const fp = fingerprint();
let old = null;
try { old = fs.readFileSync(STATE, "utf8").trim(); } catch {}

// 2. 副本进程占用时先关闭（仅杀副本路径下的进程，主安装不受影响）
const copyExe = path.join(COPY, "OpenMausBot.exe");
const needRebuild = fp !== old;
if (needRebuild) {
  log(old === null ? "首次构建副本..." : "检测到主安装更新，重建副本...");
  try {
    execFileSync("powershell", ["-NoProfile", "-Command",
      `Get-Process OpenMausBot -ErrorAction SilentlyContinue | Where-Object { $_.Path -like 'D:\\OpenMausBot-Multi*' } | Stop-Process -Force`],
      { stdio: "ignore" });
  } catch {}
  fs.mkdirSync(COPY, { recursive: true });
  // 3. 从主安装同步（/MIR 镜像；只拷差异文件，升级后增量拷贝很快）
  // robocopy 退出码 0-7 都是成功，execFileSync 会把非零当异常 → 必须捕获判断
  try {
    execFileSync("robocopy",
      [PRIMARY, COPY, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:1", "/W:1"],
      { stdio: "ignore", shell: true });
  } catch (e) {
    const rc = e.status;
    if (rc === null || rc > 7) fail(`robocopy 退出码 ${rc}: ${e.message?.slice(0, 120)}`);
  }
}

const asar = path.join(COPY, "resources", "app.asar");
const appDir = path.join(COPY, "resources", "app");
const patchedMarker = path.join(appDir, "electron", "main.mjs");

// 4. 解包 + 打补丁（仅当未解包过或刚重建了 resources）
const needExtract = needRebuild || !fs.existsSync(patchedMarker);
if (needExtract) {
  if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });
  log("解包 app.asar 并打补丁...");
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  execFileSync(npx, ["-y", "@electron/asar", "extract", asar, appDir], { stdio: "inherit", shell: true });

    const mainFile = path.join(appDir, "electron", "main.mjs");
  if (!fs.existsSync(mainFile)) fail("解包结果缺少 electron/main.mjs");
  let src = fs.readFileSync(mainFile, "utf8");
  const ANCHOR = "if (!app.requestSingleInstanceLock()) {";
  const MARK = "OpenMausBot-Multi";
  if (!src.includes(MARK)) {
    if (!src.includes(ANCHOR)) fail("未找到单实例锁锚点（上游改版需人工适配）");
    if (!src.includes('import path from "node:path"')) fail("main.mjs 缺少 path 导入");
    // userData 按实例 ID 分叉：OMB_INSTANCE_ID=2 → OpenMausBot-Multi-2（每实例独立锁作用域）
    const FORK = `// [multi-open] 副本 userData 按实例分叉 → 锁作用域分离 → 多实例并存
    const __multiId = process.env.OMB_INSTANCE_ID ? "-" + process.env.OMB_INSTANCE_ID : "";
    app.setPath("userData", path.join(app.getPath("appData"), "OpenMausBot-Multi" + __multiId));
    `;
    src = src.replace(ANCHOR, FORK + ANCHOR);
    fs.writeFileSync(mainFile, src);
  }

  // 端口段方案：每个实例按 OMB_PORT_OFFSET 偏移专属端口段（步长 500，≤12 实例全落在 <65536）
  // 替代原静态表（原表 68799+ 超过 65535 端口上限是无效端口；且所有实例挤同一段会竞态）
  const portsFile = path.join(appDir, "electron", "desktop-ports.mjs");
  if (fs.existsSync(portsFile)) {
    let ports = fs.readFileSync(portsFile, "utf8");
    if (!ports.includes("OMB_PORT_OFFSET")) {
      ports = ports.replace(
        /export const DESKTOP_PORTS = Object\.freeze\(\[[^\]]*\]\);/,
        `const BASE_PORTS = [8799, 18799, 28799, 38799, 48799, 58799];
const OFF = Number(process.env.OMB_PORT_OFFSET ?? 0);
export const DESKTOP_PORTS = Object.freeze(BASE_PORTS.map((p) => p + OFF));`,
      );
      fs.writeFileSync(portsFile, ports);
    }
  }
  // 5. 删除 asar（Electron 优先加载 resources\app 目录）+ 禁副本自更新
  fs.rmSync(asar, { force: true });
  fs.rmSync(path.join(COPY, "resources", "app-update.yml"), { force: true });
  fs.writeFileSync(STATE, fp);
  log("副本就绪（userData 分叉 + 自更新已禁用，升级跟随主安装）");
}

// 6-7. 数据目录 + 启动（OMB_NO_LAUNCH=1 时跳过启动，由 open-multi.mjs 统一编排）
if (process.env.OMB_NO_LAUNCH !== "1") {
  const DATA_DIR = path.join(
    process.env.USERPROFILE ?? "",
    process.env.OMB_INSTANCE_ID ? `.openmausbot-multi-${process.env.OMB_INSTANCE_ID}` : ".openmausbot-multi",
  );
  fs.mkdirSync(DATA_DIR, { recursive: true });
  log(`启动多开实例（独立工作区: ${DATA_DIR}）`);
  const child = spawn(copyExe, [], { detached: true, stdio: "ignore", env: { ...process.env, OMB_DATA_DIR: DATA_DIR } });
  child.unref();
}
