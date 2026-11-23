# 阶段 7：视频生成（gen-video 工具）

OpenMausBot 无原生视频功能。方案：一个 node CLI 工具（`scripts/gen-video.mjs`）+ 把用法写进 **everyBotRules**（工作区级，所有 bot — 含未来新建的 — 自动会用）。

## 工具能力

```bash
node gen-video.mjs --prompt "<画面描述>" [-o out.mp4] [--model seedance-2.0-mini] \
                   [--duration 5] [--resolution 720P] [--image 图片路径或URL]
```

- 同目录读 `config.json`（与图片 shim 共用：apiKey + baseUrl）
- 流程：POST `/v1/videos/generations` → task_id → 轮询 `/v1/tasks/{id}` → 正则扫描结果里所有 mp4/webm/gif URL → 下载 → 输出本地路径
- 结果字段容错：`result.images[].url`（数组）、`video_url`、裸字符串 URL 都能扫到
- 退出码 0 成功（stdout 最后一行是文件路径），1 失败（stderr 带原因）

## 部署

Linux（盒子）：与 shim 同目录 `~/.openmausbot/apimart-shim/gen-video.mjs` + config.json（共享）。mkdir 一个输出目录如 `/data/home/videos`。
Windows 本机：`C:/Users/<user>/.openmausbot/apimart-shim/gen-video.mjs`，输出目录 `C:/Users/<user>/.openmausbot/videos/`。

盒子无需代理（直连中转）。**Windows 本机必须带代理 env 前缀**（中转被墙）：

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 \
  node "C:/Users/<用户名>/.openmausbot/apimart-shim/gen-video.mjs" --prompt "..." -o out.mp4
```
（Node ≥24 支持 NODE_USE_ENV_PROXY 让内置 fetch 走代理；`node -v` 先确认）

**适用范围澄清**：bot 的 shell 工具在 **app 所在主机**执行（不是云电脑容器 — 云电脑只承接屏幕/点击类工具）。所以脚本必须与 app 同机部署；两边工作区各自部署一份即可覆盖各自的全部 bot。

## 让所有 bot 都会用：everyBotRules

工作区级公共规则（config.json `everyBotRules` 字段 / PATCH /api/config），**新建 bot 自动继承**。模板：

```
## 视频生成（<平台>，所有 bot 可用）

node <gen-video.mjs 绝对路径> --prompt "<画面描述>" -o <输出目录>/<名字>.mp4 [--model seedance-2.0-mini] [--duration 5] [--image 图片]

默认模型 seedance-2.0-mini（最便宜）；可选 seedance-2.5 / kling-v4-flash / veo3.1-fast / wan2.6。异步任务约1-3分钟，等待时不要中断、不要重复提交。完成后把 mp4 附给用户。视频按秒计费，生成前先跟用户确认画面描述。
```

（Windows 版开头要加代理 env 三件套，并注明"仅此命令需要，其他命令不要加"）

写入方式：
- 有 admin token：PATCH /api/config `{"everyBotRules":"..."}`（JSON 用 node 生成防转义坑）
- 远端盒子：本地生成 JSON/脚本 → push → python 合并进 config.json → 重启 serve

## 模型与成本（重要，写进 bot 规则防乱花钱）

| 档 | 模型 |
|----|------|
| 最便宜（默认）| seedance-2.0-mini |
| 中档 | seedance-2.5 / wan2.6 |
| 高档 | kling-v4 / veo3.1 / hailuo-2.3 |

按秒计费。52 个模型可选（apimart），报模型名切换。实测最短时长生成约 60-90 秒完成。

## 验证

跑一条最便宜的最短时长，确认：任务提交 → 轮询推进 → mp4 落盘（约 1.5 MB+）→ 能播放。
