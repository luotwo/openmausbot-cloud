#!/usr/bin/env node
// apimart image shim: adapts apimart.ai's async task image API (POST -> task_id -> poll -> URL)
// to the synchronous OpenAI-shape API OpenMausBot expects (POST -> data[0].b64_json).
// Listens on 127.0.0.1:8517 only. Run with NODE_USE_ENV_PROXY=1 + HTTPS_PROXY so the
// outbound calls go through the local Clash proxy (api.apimart.ai is SNI-blocked direct).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const PORT = CFG.port ?? 8517;
const BASE = CFG.baseUrl ?? "https://api.apimart.ai";
const KEY = CFG.apiKey;
const POLL_MS = CFG.pollMs ?? 2500;
const TIMEOUT_MS = CFG.timeoutMs ?? 240000;

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
};

async function apimart(pathname, options = {}) {
  const res = await fetch(BASE + pathname, {
    ...options,
    headers: { authorization: `Bearer ${KEY}`, ...(options.headers ?? {}) },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`apimart ${res.status}: ${text.slice(0, 200)}`); }
  if (!res.ok) throw new Error(`apimart ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(body) {
  const model = body.model ?? "gpt-image-2";
  const payload = { model, prompt: body.prompt };
  if (body.size && body.size !== "auto") payload.size = body.size;
  const started = await apimart("/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const first = Array.isArray(started.data) ? started.data[0] : started.data ?? started;
  const taskId = first?.task_id ?? started.task_id;
  if (!taskId) {
    // Synchronous gateway answered with an image straight away — pass it through.
    return started;
  }
  const deadline = Date.now() + TIMEOUT_MS;
  let final = null;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const t = await apimart(`/v1/tasks/${taskId}`);
    const task = t.data ?? t;
    const status = String(task.status ?? task.task_status ?? "").toLowerCase();
    if (["completed", "succeeded", "success", "finished"].includes(status)) { final = task; break; }
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(`apimart task ${taskId} ${status}: ${JSON.stringify(task.result ?? "").slice(0, 200)}`);
    }
  }
  if (!final) throw new Error(`apimart task ${taskId} timed out after ${TIMEOUT_MS / 1000}s`);
  const result = final.result ?? {};
  // result shapes seen: {images:[{url:["https://...png"]}]}, [url...], {data:[{b64_json|url}]}
  const imgs = Array.isArray(result?.images) ? result.images
    : Array.isArray(result) ? result
    : Array.isArray(result?.data) ? result.data
    : [result];
  const out = [];
  for (const item of imgs) {
    const raw = typeof item === "string" ? item : item?.url ?? item?.image_url ?? item?.imageUrl ?? item?.b64_json;
    const candidates = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.startsWith("data:image")) {
        out.push({ b64_json: candidate.slice(candidate.indexOf(",") + 1) });
        continue;
      }
      if (typeof candidate !== "string" || !candidate) continue;
      const img = await fetch(candidate); // image host, goes direct or via proxy per env
      if (!img.ok) throw new Error(`download failed ${img.status} for ${candidate.slice(0, 80)}`);
      const buf = Buffer.from(await img.arrayBuffer());
      out.push({ b64_json: buf.toString("base64") });
    }
  }
  if (out.length === 0) throw new Error(`apimart task ${taskId} returned no image URLs: ${JSON.stringify(result).slice(0, 200)}`);
  return { created: Math.floor(Date.now() / 1000), data: out };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
    return json(res, 200, { ok: true, upstream: BASE });
  }
  if (req.method === "POST" && url.pathname.endsWith("/images/generations")) {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on("end", () => {
      let body;
      try { body = JSON.parse(raw || "{}"); } catch { return json(res, 400, { error: { message: "invalid JSON body" } }); }
      if (!body.prompt) return json(res, 400, { error: { message: "prompt is required" } });
      generate(body)
        .then((data) => json(res, 200, data))
        .catch((e) => json(res, 502, { error: { message: String(e.message ?? e).slice(0, 400) } }));
    });
    return;
  }
  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    return json(res, 200, { object: "list", data: [{ id: "gpt-image-2", object: "model" }] });
  }
  json(res, 404, { error: { message: `no route: ${req.method} ${url.pathname}` } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[apimart-shim] listening on 127.0.0.1:${PORT} -> ${BASE}`);
});
