# 阶段 5：程序化操作 OpenMausBot（免 GUI）

OpenMausBot 的 app 内嵌 harness 服务器（默认 127.0.0.1:8799）。全部配置都能走 REST API，配 CLI/token 两级凭证。

## 认证三层

| 凭证 | 获取 | 能做什么 |
|------|------|---------|
| 无凭证 loopback | 同机直接 curl | **GET 只读**（/api/config 等）|
| CLI 登录 | `npx -y openmausbot@latest login` → 桌面 app 里点一次 Allow | CLI 全部命令 + 变更 |
| API token | 登录后 `openmausbot token create NAME --scope admin --out FILE --expires 30d` | Bearer 调任意 API，脚本化首选 |

**坑 ①：token 默认 scope 是 `client`，PATCH 会 403 "lacks the admin scope" — 必须 `--scope admin`。**
**坑 ②：`token create` 在 Windows 上偶发 libuv 断言崩溃（UV_HANDLE_CLOSING）导致没建成 — 用 `token list` 验证。**
**坑 ③：headless serve 形态下同机 CLI 即 owner — `login` / `token create` / `pair` 全部免点卡**（serve 自启场景无人也能拿 token）。跨机管理：在服务器上建好 token 文件后 push 回本机用。

**前置：CLI 要求 Node ≥24。** instabox 模板自带 Node 22 在 `/usr/local/bin` 会挡 apt 的 Node 24 → 所有 openmausbot 命令前置 `export PATH=/usr/bin:$PATH`（全局安装后用 `$HOME/.npm-global/bin/openmausbot`，见 references/8）。

## 新建 bot（全新部署必有的一步）

- CLI：`openmausbot new-bot`（参数看 `openmausbot help new-bot`）
- UI：侧栏 **New bot**（浏览器连 serve 时也有）
- 首次启动的新工作区通常会自动创建一个默认 Chief bot；`openmausbot bots` 确认存在再用 send/wait 验证，没有就先 new-bot

## 核心命令（登录后）

```bash
npx -y openmausbot@latest status          # 所有 bot 状态+电脑
npx -y openmausbot@latest bots            # bot 列表（含 id）
npx -y openmausbot@latest computers list|start|sleep BOT   # 云电脑管理
npx -y openmausbot@latest send BOT "文本"  # 发消息立即返回
npx -y openmausbot@latest wait --thread <id>   # 等 turn 结束（计时用）
npx -y openmausbot@latest doctor          # 服务器+引擎健康
npx -y openmausbot@latest token create ops --scope admin --out ~/.openmausbot/ops.token
```

## 常用 REST（Bearer = admin token）

```bash
T=$(cat ~/.openmausbot/ops.token); B=http://127.0.0.1:8799
curl -s $B/api/config -H "Authorization: Bearer $T"                    # 读全配置（key 字段回空串）
curl -X PATCH $B/api/config  -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d '{...}'
curl -X PATCH $B/api/bots/<botId> ... -d '{"computer":"cloud","cloudBackend":"vps"}'
curl -X PATCH $B/api/bots/<botId> ... -d '{"soul":"常驻指令..."}'        # soul 必须单独发；JSON 用 node 生成（heredoc 转义会炸）
curl -X PATCH $B/api/config  ... -d '{"everyBotRules":"所有bot的公共规则..."}'
```

配置字段速查（config.json）：`instances`（引擎）、`imageGen`（图片）、`everyBotRules`（全 bot 规则）、`vps.sshAlias`（BYO-VPS 默认别名）、`vpsServers`（命名服务器列表）、`newBots`（新建 bot 默认）。

## 免 GUI 修改的可靠姿势（远端盒子尤其）

复杂 JSON **绝不内联**：
1. 本地用 node/python 生成 JSON 文件（自动转义）
2. `npx -y instabox@latest push <本地文件> <盒子:/tmp/x.json>`（Git Bash 加 `MSYS_NO_PATHCONV=1`）
3. curl --data-binary @/tmp/x.json 或 python 合并进 config.json
4. 删临时文件

## 本机 vs 盒子的端口

- 本机 app：127.0.0.1:8799
- 盒子 serve：127.0.0.1:8799（盒子内）— 从外网用公开 URL（阶段 8）
- 盒子上跑 CLI 即 owner（serve 自启场景免点卡：`npx openmausbot pair` 直接出码）

## 普通非 instabox VPS 差异

- 无 instabox exec/push 通道：直接 SSH 操作（本地生成脚本 → scp → 执行），其余完全一致
- 服务器上操作 CLI：`ssh user@vps 'export PATH=...; openmausbot ...'`（同机即 owner，免点卡）
