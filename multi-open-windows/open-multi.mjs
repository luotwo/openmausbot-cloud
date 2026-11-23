#!/usr/bin/env node
// OpenMausBot 多开编排器（累加式）：
//   每运行一次 = 新增打开 N 个客户端（N = 弹窗设定的每批数量，默认/已保存于 count.txt）
//   实例编号累加：第一次点开 1-3，再点开 4-6，再点 7-9 ...
//   每个实例都是独立工作区（首次进入走 onboarding，可分别配对不同服务器）
//   重新问每批数量：运行「OpenMausBot-多开-设置数量」或删除 count.txt
import fs from "node:fs";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const COUNT_FILE = path.join(TOOLS, "count.txt");
const NEXTID_FILE = path.join(TOOLS, "next-id.txt");
const HOME = process.env.USERPROFILE ?? "";
const MAX_PORTS = 12;

const log = (m) => console.log("[multi] " + m);
const fail = (m) => { console.error("[multi] 失败: " + m); process.exit(2); };

// 1. 每批数量：读保存值；没有则弹窗询问
let batch = null;
try { batch = parseInt(fs.readFileSync(COUNT_FILE, "utf8").trim(), 10); } catch {}
if (!Number.isInteger(batch) || batch < 1) {
  log("弹出每批数量选择窗口...");
  const ps = [
    "Add-Type -AssemblyName Microsoft.VisualBasic;",
    "$n = [Microsoft.VisualBasic.Interaction]::InputBox(",
    "'每次双击「多开」，新增打开几个客户端？(1-6)' + [char]10 + [char]10 + '例如填 3：本次新开 3 个；再双击一次再新增 3 个，数量累加。' + [char]10 + '每个客户端是独立工作区，可分别配对不同服务器。',",
    "'OpenMausBot 多开设置', '3')",
    "if ($n -match '^\\d+$') { Write-Output $n }",
  ];
  const r = spawnSync("powershell", ["-NoProfile", "-STA", "-Command", ps.join("\n")], { encoding: "utf8", timeout: 300000 });
  batch = parseInt((r.stdout ?? "").trim(), 10);
  if (!Number.isInteger(batch) || batch < 1 || batch > 6) fail("未输入有效数量（1-6），本次不打开");
  fs.writeFileSync(COUNT_FILE, String(batch));
  log(`已记住每批数量: ${batch}（重新询问：删除 ${COUNT_FILE}）`);
}

// 2. 主安装升级检查 + 副本同步（不启动，实例由本脚本统一打开）
log("检查副本与主安装同步...");
const build = spawnSync(process.execPath, [path.join(TOOLS, "build-multi.mjs")], {
  stdio: "inherit",
  env: { ...process.env, OMB_NO_LAUNCH: "1" },
});
if (build.status !== 0) process.exit(build.status ?? 2);

// 3. 计算本批实例编号（累加；跳过已被占用的端口上限）
let nextId = 1;
try { nextId = parseInt(fs.readFileSync(NEXTID_FILE, "utf8").trim(), 10); } catch {}
if (!Number.isInteger(nextId) || nextId < 1) nextId = 1;
// 已有数据目录也算占用（幂等保护）
for (let i = 1; i < nextId + batch; i++) {
  if (fs.existsSync(path.join(HOME, `.openmausbot-multi-${i}`)) && i >= nextId) nextId = i + 1;
}
if (nextId + batch - 1 > MAX_PORTS) fail(`已到本机端口上限（${MAX_PORTS} 个实例）。不再新增；可关闭部分实例或让 Claude 再扩端口`);

// 4. 打开本批实例（每实例：独立 userData + 独立工作区 + 端口自动回退）
//    必须错峰启动：同时启动会竞态（健康检查把别的实例的启动中端口误判为冲突 → abort）
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 副本目录解析（与 build-multi.mjs 同逻辑）：OMB_COPY_DIR > 已有副本的盘 > 第一个非 C 盘 > 用户目录
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
const exe = path.join(pickCopyDir(), "OpenMausBot.exe");
const opened = [];
for (let k = 0; k < batch; k++) {
  const id = nextId + k;
  const dataDir = path.join(HOME, `.openmausbot-multi-${id}`);
  fs.mkdirSync(dataDir, { recursive: true });
  spawn(exe, [], {
    detached: true, stdio: "ignore",
    env: { ...process.env, OMB_INSTANCE_ID: String(id), OMB_DATA_DIR: dataDir },
  }).unref();
  opened.push(id);
  if (k < batch - 1) {
    log(`实例 ${id} 已启动，${10}s 后启动下一个（错峰防端口竞态）...`);
    await sleep(10000);
  }
}
fs.writeFileSync(NEXTID_FILE, String(nextId + batch));
log(`已新增打开 ${batch} 个客户端：实例 ${opened.join(", ")}（各自独立工作区，首次进入走 onboarding 后配对服务器）`);
