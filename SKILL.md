---
name: openmausbot-cloud
description: 在云主机（instabox 盒子或任意 Debian/Ubuntu VPS）上部署 OpenMausBot 并接入模型引擎（GLM/智谱、OpenAI 兼容中转）、图片生成（apimart 异步转同步 shim）、视频生成（gen-video 工具）、BYO-VPS 远程电脑、以及秒级 headless serve 迁移的完整实战手册。当用户提到：部署/安装 OpenMausBot（MausBot）、新账号/新云主机跑 mausbot、接入智谱 GLM / Z.ai / openai-compat 自定义引擎、给 bot 加图片生成或视频生成、连 apimart 画图生视频、BYO-VPS / 把远程服务器变成 bot 的电脑、openmausbot 响应慢要迁移秒级、openmausbot serve / pairing / everyBotRules / bots.json / config.json instances 等关键词时，务必使用本 skill，即使用户没有明确说"部署"。
---

# OpenMausBot 云端部署与生成能力接入

一套在云 Linux 主机上从零跑通 OpenMausBot 全能力的实操手册。全部步骤来自 2026-11 真实部署（instabox 免费盒子 + Debian 13，v0.1.177），每个坑都真实踩过。

## 高危红牌（先读，血的教训）

1. **绝不要设置全局 `HTTPS_PROXY` 环境变量**（setx / export 到用户环境）。本机 claude CLI 通常走国内 API（如智谱 bigmodel），全局代理会把国内流量塞进代理绕国际一圈，对话从 26 秒涨到 156 秒。代理只在需要的进程内显式注入（shim 启动脚本、单条命令前缀）。
2. **instabox 免费计划三限**：1 个盒子（超了要先删旧盒子，需用户确认）、空闲 30 分钟自动暂停（HTTP 请求/exec 可自动唤醒）、连续运行 ~120 分钟后冷却 5-20 分钟。用户要消除需升级付费计划。
3. **Git Bash（Windows）两个坑**：① `instabox push` 的远程路径 `/data/...` 会被 MSYS 转换加 `C:/Program Files/Git` 前缀 → 命令前加 `export MSYS_NO_PATHCONV=1`；② `instabox exec` 里嵌套引号（引号里再套引号）必炸 → 一律走「本地写脚本文件 → push 上去 → 执行」模式，绝不内联复杂命令。
4. **Windows 本机 `python3` 是商店假别名**（exit 49 无输出）→ 本地解析 JSON 一律用 node。
5. **OpenMausBot 图片通道只收内联 `b64_json`**，绝不接受 URL 返回；很多中转 API 是异步任务式（返回 task_id）→ 需要 shim 转换（见 references/6）。

## 参数清单（开工前收集/确认）

| 参数 | 说明 | 默认 |
|------|------|------|
| instabox 账号 | 已登录即可（`npx -y instabox@latest whoami`）；无浏览器场景用 `instabox login --agent` | — |
| 盒子名 | 如 `openmausbot`；免费计划先查配额 `instabox ls` | — |
| GLM 服务 | 国内 BigModel `https://open.bigmodel.cn/api/paas/v4` 或国际 Z.ai `https://api.z.ai/api/paas/v4` | 国内 |
| GLM key | 智谱控制台获取，形如 `xxxx.xxxx` | 必填 |
| 模型 ID | 如 `glm-5.3`（实例配置里填，bot 侧可再换） | glm-5.3 |
| 图片/视频 API | OpenAI 兼容中转（如 apimart `https://api.apimart.ai/v1`）+ key；视频模型 `seedance-2.0-mini` 最便宜 | 可选 |
| 代理 | 仅国内网络访问被墙 API 时需要（如 Clash `http://127.0.0.1:7897`）；海外盒子直连不需要 | 视情况 |

## 阶段路由（按用户目标跳读对应 reference）

| 用户想要 | 走哪步 | 参考文件 |
|---------|--------|---------|
| A. 新账号/新盒子从零部署 | 创建盒子 → 装 OpenMausBot | [references/1-box-setup.md](references/1-box-setup.md) → [references/2-install.md](references/2-install.md) |
| B. 接入 GLM / 自定义引擎 | 改 config.json instances + 重启 | [references/3-engine-glm.md](references/3-engine-glm.md) |
| C. 把远程盒子变成 bot 的电脑（本机 app 连云主机）| BYO-VPS 全套路 | [references/4-byo-vps.md](references/4-byo-vps.md) |
| D. 程序化/脚本化操作 app（免 GUI）| CLI 登录 → admin token → REST API | [references/5-api-automation.md](references/5-api-automation.md) |
| E. 图片生成 | imageGen + 异步转同步 shim | [references/6-image-shim.md](references/6-image-shim.md) |
| F. 视频生成 | gen-video 工具 + everyBotRules | [references/7-video-tool.md](references/7-video-tool.md) |
| G. 响应慢 → 秒级迁移 | headless serve + systemd + 公网入口 | [references/8-headless-serve.md](references/8-headless-serve.md) |
| H. 非 instabox 的普通 VPS | 阶段 2-8 大部分通用，差异见各文件「普通 VPS 差异」段 | 同上 |

## 推荐部署顺序（全新盒子）

1 → 2 →（3 GLM）→（6 图片 + 7 视频）→（8 秒级 serve 作为最终形态）。桌面 app 形态适合先验证，serve 形态适合作为长期主力 — 直接一步到位也完全可以（8 依赖 2 的安装）。

## 可复用脚本（scripts/ 目录，无需重写）

| 文件 | 用途 | 部署位置 |
|------|------|---------|
| `shim-server.mjs` | 图片异步转同步 shim（node，无第三方依赖）| 跑图片 API 的那台机器（盒子或本机）|
| `gen-video.mjs` | 视频生成 CLI（node，无第三方依赖）| 同上 |
| `config.example.json` | shim/gen-video 共用配置模板（填 key）| 与上面脚本同目录 |
| `start-shim.cmd` | Windows 侧 shim 启动器（进程内代理 env）| 仅国内 Windows 本机需要 |
| `openmausbot-serve.service` | headless serve 的 systemd 单元模板 | Linux 主机 |
| `apimart-shim.service` | 图片 shim 的 systemd 单元模板 | Linux 主机 |

这些脚本读同目录 `config.json`（含 key），本身不含任何密钥。部署时 push 上去 + 建 `config.json` + chmod 600 即可。

## 验证清单（部署完成的标志）

- [ ] 盒子上 `/opt/OpenMausBot/openmausbot` 存在，app/serve 能启动
- [ ] 引擎状态 available + authenticated（`~/.openmausbot/providers/engine-status.json`）
- [ ] 图片：`curl -X POST http://127.0.0.1:8517/v1/images/generations -H "Content-Type: application/json" -d '{"model":"gpt-image-2","prompt":"test circle","quality":"low"}'` 返回含 `b64_json`
- [ ] 视频：`gen-video.mjs --prompt "test" -o t.mp4` 产出 mp4
- [ ] 秒级（如做了阶段 8）：盒子内 CLI send+wait ≤ 10s；浏览器配对码可连
