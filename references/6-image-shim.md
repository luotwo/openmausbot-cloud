# 阶段 6：图片生成（异步 API → 同步 b64 shim）

OpenMausBot 的 imageGen 只接受**同步返回内联 b64_json** 的 OpenAI 形状接口。很多中转（apimart 等）的图像 API 是**异步任务式**：POST 返回 task_id → 轮询 → 图片 URL。两端不兼容 → 用一个无依赖 node shim 转换。

## 架构

```
OpenMausBot imageGen (custom provider)
    → http://127.0.0.1:8517/v1  (shim, 同步)
        → POST https://api.apimart.ai/v1/images/generations  (拿 task_id)
        → 轮询 GET /v1/tasks/{task_id} 直到 completed
        → 下载 result.images[].url（注意 url 是数组！）
        → base64 → 返回 {data:[{b64_json}]}
```

shim 源码：本 skill `scripts/shim-server.mjs`（纯 node 内置模块，无第三方依赖）。

## 部署（Linux 主机 — 推荐放盒子，直连中转无需代理）

```bash
mkdir -p ~/.openmausbot/apimart-shim
# 放入 shim-server.mjs（改名 server.mjs）+ config.json（chmod 600）：
# { "port": 8517, "baseUrl": "https://api.apimart.ai", "apiKey": "<key>", "pollMs": 2500, "timeoutMs": 240000 }
```

systemd 单元（模板 `scripts/apimart-shim.service`）：`ExecStart=/usr/bin/node .../server.mjs`，`sudo systemctl enable --now apimart-shim`。

验证：`curl http://127.0.0.1:8517/health` → `{"ok":true,...}`；完整测试（花一张最低质量图的钱）：
```bash
curl -X POST http://127.0.0.1:8517/v1/images/generations -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"a small circle on white background","size":"1024x1024","quality":"low"}'
```
成功 = HTTP 200 + data[0].b64_json。

## OpenMausBot 侧配置（config.json，工作区级 = 所有 bot 生效）

```json
"imageGen": {
  "provider": "custom",
  "customUrl": "http://127.0.0.1:8517/v1",
  "customModel": "gpt-image-2",
  "customApiKey": "<key，shim 其实忽略它，但字段必须配>"
}
```
改完重启 app/serve；验证 GET /api/config 里 `imageGen.ready: true`。

## Windows 本机部署差异

1. shim 跑在本机（端口 8517 同），出站中转 API 可能被墙 → **进程内代理**：用 `scripts/start-shim.cmd`（set NODE_USE_ENV_PROXY=1 + HTTPS_PROXY=Clash 后启动 node）。绝不全局设代理（红牌 1）。
2. 自启：计划任务 `schtasks //Create //TN OpenMausBot-ImageShim //TR <start-shim.cmd 路径> //SC ONLOGON //F`

## 关键坑全录（全部真实踩过）

| 坑 | 现象 | 处理 |
|----|------|------|
| DNS 污染 + SNI 阻断 | 中转域名解析到假 IP；钉真 IP 也被秒断（HTTP 000 in 0.2s）| 国内网络必须走代理出站；hosts 钉 IP 无效别浪费时间 |
| 异步任务式 API | 同步形状请求返回 `{data:[{task_id}]}` 而不是图片 | 就是 shim 存在的理由 |
| 轮询结果 `url` 是数组 | `result.images[].url` = `["https://...png"]` | shim 已处理（数组取首个）|
| app 拒收 URL | 报「必须返回 base64 图片数据」 | app 硬性只收 b64_json，设计如此 |
| 中转 /models 返回非 JSON | GET /models 空/HTML | 正常，不影响生图；别用它做连通性判断 |
| 图片直链下载 | getapib.org 等图床通常可直连 | shim 的下载步骤走系统网络（可不经代理）|

## 模型与成本

`gpt-image-2` 默认；quality `low` + 1024x1024 是最便宜档（验证用）。换模型改 `customModel` 即可。
