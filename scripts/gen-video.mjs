#!/usr/bin/env node
// gen-video — apimart.ai text/image-to-video CLI for OpenMausBot bots.
// Usage:
//   node gen-video.mjs --prompt "..." [--model seedance-2.0-mini] [--image PATH_OR_URL]
//                     [--duration 5] [--resolution 720P] [-o out.mp4]
// Async task API: POST /v1/videos/generations -> task_id -> poll /v1/tasks/{id} -> download mp4.
// Needs Clash proxy (env HTTPS_PROXY) because api.apimart.ai is SNI-blocked direct.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const BASE = CFG.baseUrl ?? "https://api.apimart.ai";
const KEY = CFG.apiKey;
const POLL_MS = 5000;
const TIMEOUT_MS = 15 * 60 * 1000; // video can take minutes

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name === "--out" ? "-o" : name);
  return i >= 0 ? args[i + 1] : undefined;
};
const prompt = opt("--prompt");
let model = opt("--model") ?? "seedance-2.0-mini";
const duration = opt("--duration");
const resolution = opt("--resolution");
const image = opt("--image");
const outArg = opt("--out") ?? opt("-o") ?? `video-${Date.now()}.mp4`;

if (!prompt && !image) {
  console.error("Usage: node gen-video.mjs --prompt \"...\" [--model ID] [--image PATH|URL] [--duration 5] [--resolution 720P] [-o out.mp4]");
  console.error("Models: seedance-2.0-mini (cheap) | seedance-2.5 | kling-v4-flash | kling-v3 | veo3.1-fast | wan2.6 ... (https://docs.apimart.ai)");
  process.exit(2);
}

const headers = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const body = { model, prompt: prompt ?? "" };
if (duration) body.duration = Number(duration);
if (resolution) body.resolution = resolution;
if (image) {
  body.image = image.startsWith("http")
    ? image
    : `data:image/${path.extname(image).slice(1) || "png"};base64,${fs.readFileSync(image).toString("base64")}`;
}

const api = async (p, options = {}) => {
  const res = await fetch(BASE + p, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${res.status}: ${text.slice(0, 200)}`); }
  if (res.status >= 400) throw new Error(`${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const started = await api("/v1/videos/generations", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const first = Array.isArray(started.data) ? started.data[0] : started.data ?? started;
  const taskId = first?.task_id ?? started.task_id;
  if (!taskId) throw new Error(`no task_id in response: ${JSON.stringify(started).slice(0, 200)}`);
  console.error(`[gen-video] task ${taskId} submitted (${model})`);

  const deadline = Date.now() + TIMEOUT_MS;
  let final = null;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const t = await api(`/v1/tasks/${taskId}`);
    const task = t.data ?? t;
    const status = String(task.status ?? task.task_status ?? "").toLowerCase();
    if (["completed", "succeeded", "success", "finished"].includes(status)) { final = task; break; }
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(`task ${taskId} ${status}: ${JSON.stringify(task.result ?? task.error ?? "").slice(0, 200)}`);
    }
    console.error(`[gen-video] ${status ?? "waiting"}...`);
  }
  if (!final) throw new Error(`task ${taskId} timed out after ${TIMEOUT_MS / 60000} min`);

  // Collect video URLs: shapes seen: {video_url}, {url}, {videos:[{url}]}, {result:{...}}
  const r = final.result ?? final;
  const collected = [];
  const scan = (node, depth = 0) => {
    if (depth > 4 || node == null) return;
    if (typeof node === "string") {
      if (/^https?:\/\//.test(node) && /\.(mp4|webm|mov|gif)(\?|$)/i.test(node)) collected.push(node);
      return;
    }
    if (Array.isArray(node)) { node.forEach((n) => scan(n, depth + 1)); return; }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (/url|video/i.test(k) && typeof v === "string" && /^https?:\/\//.test(v)) collected.push(v);
        else scan(v, depth + 1);
      }
    }
  };
  scan(r);
  if (collected.length === 0) throw new Error(`no video URL in result: ${JSON.stringify(r).slice(0, 300)}`);

  const target = path.resolve(outArg);
  const dl = await fetch(collected[0]);
  if (!dl.ok) throw new Error(`download failed ${dl.status}`);
  fs.writeFileSync(target, Buffer.from(await dl.arrayBuffer()));
  console.log(target);
  console.error(`[gen-video] done: ${Math.round(fs.statSync(target).size / 1024)} KB <- ${collected[0].slice(0, 80)}`);
} catch (e) {
  console.error(`[gen-video] FAILED: ${e.message ?? e}`);
  process.exit(1);
}
