#!/usr/bin/env node
// OpenMausBot 多开启动逻辑（全部在 node 里做，cmd 只调用本脚本）
// 升级安全设计：主安装永不改动、正常自动升级；
// 本脚本检测主安装 app.asar 指纹变化 → 自动重建副本 → 打 userData 分叉补丁 → 启动。
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

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

// 主安装目录：动态检测（绝不写死）。优先级：OMB_PRIMARY_DIR > 运行中进程 > 注册表卸载项 > 常见路径 > 桌面快捷方式
// 副本目录会被自动排除（判定条件：OpenMausBot.exe 存在 + resources/app.asar 存在；副本没有 asar）
function detectPrimaryDir() {
  if (process.env.OMB_PRIMARY_DIR) return path.resolve(process.env.OMB_PRIMARY_DIR);
  const valid = (dir) => {
    try {
      return !!dir && fs.existsSync(path.join(dir, "OpenMausBot.exe")) &&
        (fs.existsSync(path.join(dir, "resources", "app.asar")) || fs.existsSync(path.join(dir, "resources", "app", "package.json"))) &&
        path.resolve(dir).toLowerCase() !== path.resolve(COPY).toLowerCase();
    } catch { return false; }
  };
  // 1. 运行中的进程（可能同时列出主/副本 —— valid() 靠 app.asar 排除副本）
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command",
      "Get-Process OpenMausBot -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -Unique"],
      { encoding: "utf8", timeout: 20000 });
    for (const line of (out ?? "").split(/\r?\n/)) {
      const p = line.trim();
      if (p && valid(path.dirname(p))) return path.dirname(p);
    }
  } catch {}
  // 2. 注册表卸载项（NSIS 安装器写入 InstallLocation，支持自定义安装路径）
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command",
      "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*OpenMausBot*' } | Select-Object -First 1 -ExpandProperty InstallLocation -ErrorAction SilentlyContinue"],
      { encoding: "utf8", timeout: 20000 });
    const p = (out ?? "").trim();
    if (p && valid(p)) return p;
  } catch {}
  // 3. 常见路径
  const common = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "openmausbot"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "openmausbot"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "openmausbot"),
  ].filter(Boolean);
  for (const dir of common) if (valid(dir)) return dir;
  // 4. 桌面快捷方式目标
  try {
    const lnk = path.join(process.env.USERPROFILE ?? "", "Desktop", "OpenMausBot.lnk");
    if (fs.existsSync(lnk)) {
      const out = execFileSync("powershell", ["-NoProfile", "-Command",
        `$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${lnk.replace(/'/g, "''")}'); Write-Output $s.TargetPath`],
        { encoding: "utf8", timeout: 20000 });
      const p = (out ?? "").trim();
      if (p && valid(path.dirname(p))) return path.dirname(p);
    }
  } catch {}
  return null;
}
const _detected = detectPrimaryDir();
if (!_detected) {
  console.error("[multi-build] 失败: 未找到 OpenMausBot 主安装目录（已检测运行进程/注册表/常见路径/桌面快捷方式）。请设环境变量 OMB_PRIMARY_DIR 指向后重试");
  process.exit(2);
}
const PRIMARY = _detected;
const log = (m) => console.log("[multi] " + m);
const fail = (m) => { console.error("[multi] 失败: " + m); process.exit(2); };

// 主安装品牌补丁：窗口标题 + locales + server 默认 bot 名 → BSCBot
// 幂等（OMB_REBRAND_TO 标记）；要求主安装已关闭；升级后指纹变化时自动补回；.omb-bak 可回滚
function maybePatchPrimary() {
  if (process.env.OMB_PATCH_PRIMARY !== "1") return;
  const asar = path.join(PRIMARY, "resources", "app.asar");
  if (!fs.existsSync(asar)) return;
  let raw = fs.readFileSync(asar);
  if (raw.includes("OMB_REBRAND_TO")) { log("主安装已含品牌补丁，跳过"); return; }
  const running = (() => {
    try {
      const esc = PRIMARY.replace(/\\/g, "\\\\").replace(/'/g, "''");
      const out = execFileSync("powershell", ["-NoProfile", "-Command",
        `(Get-Process OpenMausBot -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${esc}*' } | Measure-Object).Count`],
        { encoding: "utf8", timeout: 20000 });
      return parseInt((out ?? "0").trim(), 10) > 0;
    } catch { return true; } // 检测失败按运行中处理（保守跳过）
  })();
  if (running) { log("主安装正在运行，跳过品牌补丁（关闭所有 OpenMausBot 窗口后再点一次多开即可补上）"); return; }
  const BRAND = process.env.OMB_BRAND ?? "BSCBot";
  const bak = asar + ".omb-bak";
  if (!fs.existsSync(bak)) { fs.copyFileSync(asar, bak); log("已备份主安装 asar → " + bak); }
  const tmp = path.join(process.env.TEMP ?? PRIMARY, "omb-primary-" + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    execFileSync(npx, ["-y", "@electron/asar", "extract", asar, tmp], { stdio: "inherit", shell: true });
    const mf = path.join(tmp, "electron", "main.mjs");
    let src = fs.readFileSync(mf, "utf8").replace(/\r\n/g, "\n");
    if (!src.includes("OMB_REBRAND_TO")) {
      const HELPER_ANCHOR = "function mainWindowTitle() {";
      const HELPER = `const OMB_REBRAND_FROM = /MausBot|OpenMausBot/g;\nconst OMB_REBRAND_TO = ${JSON.stringify(BRAND)};\nfunction rebrand(t) { return typeof t === "string" ? t.replace(OMB_REBRAND_FROM, OMB_REBRAND_TO) : t; }\nfunction mainWindowTitle() {`;
      if (!src.includes(HELPER_ANCHOR)) fail("主安装品牌补丁：未找到 mainWindowTitle 锚点");
      src = src.replace(HELPER_ANCHOR, HELPER);
      const TITLE_ANCHOR = `  win.setTitle(mainWindowTitle());\n  win.webContents.on("page-title-updated", event => {\n    if (!desktopRemoteAccess && !activeEnvironment(environmentsState)) return;\n    event.preventDefault();\n    win.setTitle(mainWindowTitle());\n  });`;
      const TITLE_NEW = `  win.setTitle(rebrand(mainWindowTitle()));\n  win.webContents.on("page-title-updated", (event, pageTitle) => {\n    event.preventDefault();\n    win.setTitle(rebrand(typeof pageTitle === "string" && pageTitle ? pageTitle : mainWindowTitle()));\n  });`;
      if (!src.includes(TITLE_ANCHOR)) fail("主安装品牌补丁：未找到标题处理器锚点");
      src = src.replace(TITLE_ANCHOR, TITLE_NEW);
      fs.writeFileSync(mf, src);
    }
    const locDir = path.join(tmp, "src", "locales");
    if (fs.existsSync(locDir)) {
      let n = 0;
      for (const f of fs.readdirSync(locDir)) {
        if (!f.endsWith(".json")) continue;
        const p = path.join(locDir, f);
        let t = fs.readFileSync(p, "utf8");
        const nb = t.replace(/OpenMausBot/g, BRAND).replace(/MausBot/g, BRAND);
        if (nb !== t) { fs.writeFileSync(p, nb); n++; }
      }
      if (n) log(`主安装 locales 品牌文案已改：${n} 个语言文件`);
    }
    execFileSync(npx, ["-y", "@electron/asar", "pack", tmp, asar], { stdio: "inherit", shell: true });
    console.log(`[multi-build] 主安装品牌补丁完成：窗口标题/界面文案 → ${BRAND}（备份: ${bak}）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
// server/index.js 是 asar 外的独立目录文件，直接精准替换默认 bot 名
function patchPrimaryServerIndex() {
  const sidx = path.join(PRIMARY, "resources", "server", "index.js");
  if (!fs.existsSync(sidx)) return;
  const BRAND = process.env.OMB_BRAND ?? "BSCBot";
  let s = fs.readFileSync(sidx, "utf8");
  if (s.includes('"BSCBot"')) return;
  const n = (s.match(/"MausBot"/g) ?? []).length;
  if (n === 0) return;
  s = s.replace(/"MausBot"/g, `"${BRAND}"`);
  fs.writeFileSync(sidx, s);
  console.log(`[multi-build] 主安装 server 默认 bot 名已改：${n} 处`);
}
log(`主安装目录: ${PRIMARY}`);
const ASAR = path.join(PRIMARY, "resources", "app.asar");
const STATE = path.join(COPY, "primary-app.asar.state");

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
    const escCopy = COPY.replace(/\\/g, "\\\\").replace(/'/g, "''");
    execFileSync("powershell", ["-NoProfile", "-Command",
      `Get-Process OpenMausBot -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '${escCopy}*' } | Stop-Process -Force`],
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

// 主安装品牌补丁：升级重建时自动尝试；或显式 OMB_PATCH_PRIMARY=1（要求主安装已关闭）
if (needRebuild || process.env.OMB_PATCH_PRIMARY === "1") {
  maybePatchPrimary();
  patchPrimaryServerIndex();
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

  // 品牌改名：窗口标题（任务栏/标题栏）MausBot/OpenMausBot → BSCBot（拦页面标题事件，含未读数前缀）
  const BRAND = process.env.OMB_BRAND ?? "BSCBot";
  const mainFile2 = path.join(appDir, "electron", "main.mjs");
  if (fs.existsSync(mainFile2)) {
    let msrc = fs.readFileSync(mainFile2, "utf8").replace(/\r\n/g, "\n"); // 归一化行尾（asar 内可能是 CRLF，锚点用 LF）
    if (!msrc.includes("OMB_REBRAND_TO")) {
      const HELPER_ANCHOR = "function mainWindowTitle() {";
      const HELPER = `const OMB_REBRAND_FROM = /MausBot|OpenMausBot/g;
const OMB_REBRAND_TO = ${JSON.stringify(BRAND)};
function rebrand(t) { return typeof t === "string" ? t.replace(OMB_REBRAND_FROM, OMB_REBRAND_TO) : t; }
function mainWindowTitle() {`;
      if (!msrc.includes(HELPER_ANCHOR)) fail("品牌补丁：未找到 mainWindowTitle 锚点");
      msrc = msrc.replace(HELPER_ANCHOR, HELPER);
      const TITLE_ANCHOR = `  win.setTitle(mainWindowTitle());
  win.webContents.on("page-title-updated", event => {
    if (!desktopRemoteAccess && !activeEnvironment(environmentsState)) return;
    event.preventDefault();
    win.setTitle(mainWindowTitle());
  });`;
      const TITLE_NEW = `  win.setTitle(rebrand(mainWindowTitle()));
  win.webContents.on("page-title-updated", (event, pageTitle) => {
    event.preventDefault();
    win.setTitle(rebrand(typeof pageTitle === "string" && pageTitle ? pageTitle : mainWindowTitle()));
  });`;
      if (!msrc.includes(TITLE_ANCHOR)) fail("品牌补丁：未找到窗口标题处理器锚点");
      msrc = msrc.replace(TITLE_ANCHOR, TITLE_NEW);
      fs.writeFileSync(mainFile2, msrc);
      console.log(`[multi-build] 品牌补丁完成：窗口标题 → ${BRAND}`);
    }
  }

  // 可见品牌树：界面翻译文案（locales）+ server 默认 bot 名（精准引号字符串替换）
  const localesDir = path.join(appDir, "src", "locales");
  if (fs.existsSync(localesDir)) {
    let changed = 0;
    for (const f of fs.readdirSync(localesDir)) {
      if (!f.endsWith(".json")) continue;
      const p = path.join(localesDir, f);
      let t = fs.readFileSync(p, "utf8");
      const before = t;
      t = t.replace(/OpenMausBot/g, BRAND).replace(/MausBot/g, BRAND);
      if (t !== before) { fs.writeFileSync(p, t); changed++; }
    }
    if (changed) console.log(`[multi-build] locales 品牌文案已改：${changed} 个语言文件`);
  }
  const serverIndex = path.join(appDir, "..", "server", "index.js");
  if (fs.existsSync(serverIndex)) {
    let s = fs.readFileSync(serverIndex, "utf8");
    if (!s.includes('"BSCBot"')) {
      const n = (s.match(/"MausBot"/g) ?? []).length;
      s = s.replace(/"MausBot"/g, `"${BRAND}"`);
      fs.writeFileSync(serverIndex, s);
      console.log(`[multi-build] server 默认 bot 名已改：${n} 处`);
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
