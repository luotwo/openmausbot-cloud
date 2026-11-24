#!/usr/bin/env node
// OpenMausBot 多开编排器 v2（累加 + 重启恢复）：
//   - 双击「多开」：已有客户端时弹窗三选一（恢复全部 / 新增一批 / 取消）；没有客户端时问每批数量后新增
//   - 数据永不丢：每个客户端的聊天记录/配对都在磁盘数据目录（重启不消失），恢复=用原编号+原目录重新拉起
//   - 端口段：OMB_PORT_OFFSET=(实例号-1)*500，实例间零冲突
//   - 自动化入口：环境变量 OMB_ACTION=restore|add 可免弹窗（开机自启/脚本用）
import fs from "node:fs";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const COUNT_FILE = path.join(TOOLS, "count.txt");
const NEXTID_FILE = path.join(TOOLS, "next-id.txt");
const HOME = process.env.USERPROFILE ?? "";
const MAX_INSTANCES = 12;
const STAGGER_MS = 10000;

const log = (m) => console.log("[multi] " + m);
const fail = (m) => { console.error("[multi] 失败: " + m); process.exit(2); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickCopyDir() {
  if (process.env.OMB_COPY_DIR) return path.join(process.env.OMB_COPY_DIR, "OpenMausBot-Multi");
  const letters = "DEFGHIJKLMNOPQRSTUVWXYZ".split("");
  for (const L of letters) {
    const p = `${L}:\\OpenMausBot-Multi`;
    if (fs.existsSync(p)) return p;
  }
  for (const L of letters) {
    if (fs.existsSync(`${L}:\\`)) return `${L}:\\OpenMausBot-Multi`;
  }
  return path.join(process.env.USERPROFILE ?? "", "OpenMausBot-Multi");
}

// 1. 副本同步/升级检查（不启动，统一编排）
log("检查副本与主安装同步...");
const build = spawnSync(process.execPath, [path.join(TOOLS, "build-multi.mjs")], {
  stdio: "inherit",
  env: { ...process.env, OMB_NO_LAUNCH: "1" },
});
if (build.status !== 0) process.exit(build.status ?? 2);

const exe = path.join(pickCopyDir(), "OpenMausBot.exe");

// 2. 枚举已有实例：编号目录 + 无编号 legacy 目录（记作 0）
function listExistingIds() {
  const ids = [];
  if (fs.existsSync(path.join(HOME, ".openmausbot-multi"))) ids.push(0);
  try {
    for (const name of fs.readdirSync(HOME)) {
      const m = name.match(/^\.openmausbot-multi-(\d+)$/);
      if (m) ids.push(parseInt(m[1], 10));
    }
  } catch {}
  return [...new Set(ids)].sort((a, b) => a - b);
}

function dataDirOf(id) {
  return id === 0 ? path.join(HOME, ".openmausbot-multi") : path.join(HOME, `.openmausbot-multi-${id}`);
}

function launch(id) {
  const dataDir = dataDirOf(id);
  fs.mkdirSync(dataDir, { recursive: true });
  const env = { ...process.env, OMB_DATA_DIR: dataDir };
  if (id !== 0) { // 0 = legacy 实例（userData 不带编号，保持向后兼容）
    env.OMB_INSTANCE_ID = String(id);
    env.OMB_PORT_OFFSET = String((id - 1) * 500);
  }
  spawn(exe, [], { detached: true, stdio: "ignore", env }).unref();
  return dataDir;
}

function readBatch() {
  let batch = null;
  try { batch = parseInt(fs.readFileSync(COUNT_FILE, "utf8").trim(), 10); } catch {}
  if (!Number.isInteger(batch) || batch < 1) {
    const ps = [
      "Add-Type -AssemblyName Microsoft.VisualBasic;",
      "$n = [Microsoft.VisualBasic.Interaction]::InputBox(",
      "'每次双击「多开」，新增打开几个客户端？(1-6)' + [char]10 + [char]10 + '例如填 3：本次新开 3 个；再双击一次再新增 3 个，数量累加。',",
      "'OpenMausBot 多开设置', '3')",
      "if ($n -match '^\\d+$') { Write-Output $n }",
    ];
    const r = spawnSync("powershell", ["-NoProfile", "-STA", "-Command", ps.join("\n")], { encoding: "utf8", timeout: 300000 });
    batch = parseInt((r.stdout ?? "").trim(), 10);
    if (!Number.isInteger(batch) || batch < 1 || batch > 6) fail("未输入有效数量（1-6），本次不打开");
    fs.writeFileSync(COUNT_FILE, String(batch));
    log(`已记住每批数量: ${batch}（重新询问：删除 ${COUNT_FILE}）`);
  }
  return batch;
}

function nextIdForNewBatch() {
  let nextId = 1;
  try { nextId = parseInt(fs.readFileSync(NEXTID_FILE, "utf8").trim(), 10); } catch {}
  if (!Number.isInteger(nextId) || nextId < 1) nextId = 1;
  for (let i = 1; i < nextId + 64; i++) {
    if (fs.existsSync(dataDirOf(i)) && i >= nextId) nextId = i + 1;
  }
  return nextId;
}

// 3. 决定动作：env 指定 > 已有客户端时弹三选一 > 空工作区问批数量
//    OMB_ACTION=restore|add 免弹窗；OMB_RESTORE_IDS="9,10,11" 只恢复指定编号（开机自启/脚本用）
const existing = listExistingIds();
let action = process.env.OMB_ACTION ?? "";
let restoreFilter = null;
if (process.env.OMB_RESTORE_IDS) {
  action = "restore";
  restoreFilter = process.env.OMB_RESTORE_IDS.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n >= 0);
}
if (!action) {
  if (existing.length === 0) {
    action = "add";
  } else {
    log(`检测到 ${existing.length} 个已有客户端，弹窗选择...`);
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$r = [System.Windows.Forms.MessageBox]::Show(",
      `'检测到 ${existing.length} 个已有客户端（聊天记录都在）。' + [char]10 + [char]10 + '[是] 恢复它们    [否] 新增一批    [取消] 什么都不做',`,
      "'OpenMausBot 多开', 'YesNoCancel', 'Question')",
      "Write-Output $r",
    ].join("; ");
    const r = spawnSync("powershell", ["-NoProfile", "-STA", "-Command", ps], { encoding: "utf8", timeout: 300000 });
    const ans = (r.stdout ?? "").trim();
    action = ans === "Yes" ? "restore" : ans === "No" ? "add" : "cancel";
  }
}

// 4. 执行
if (action === "restore") {
  const targetIds = restoreFilter ?? existing;
  if (targetIds.length === 0) fail("没有可恢复的客户端（数据目录为空）");
  const reopened = [];
  let k = 0;
  for (const id of targetIds) {
    const dir = launch(id);
    reopened.push(id);
    if (k < targetIds.length - 1) {
      log(`实例 ${id} 恢复中（工作区: ${dir}），${STAGGER_MS / 1000}s 后恢复下一个...`);
      await sleep(STAGGER_MS);
    }
    k++;
  }
  log(`已恢复 ${reopened.length} 个客户端：实例 ${reopened.join(", ")}（聊天记录/配对完整保留）`);
} else if (action === "add") {
  const batch = readBatch();
  let nextId = nextIdForNewBatch();
  if (nextId + batch - 1 > MAX_INSTANCES) fail(`已达 ${MAX_INSTANCES} 实例上限。关闭部分实例后重试`);
  const opened = [];
  for (let k = 0; k < batch; k++) {
    const id = nextId + k;
    const dir = launch(id);
    opened.push(id);
    if (k < batch - 1) {
      log(`实例 ${id} 已启动（端口段 ${(id - 1) * 500}+），${STAGGER_MS / 1000}s 后启动下一个...`);
      await sleep(STAGGER_MS);
    }
  }
  fs.writeFileSync(NEXTID_FILE, String(nextId + batch));
  log(`已新增打开 ${batch} 个客户端：实例 ${opened.join(", ")}`);
} else {
  log("已取消，不做任何操作");
}
