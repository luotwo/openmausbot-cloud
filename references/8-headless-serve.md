# 阶段 8：秒级迁移（headless serve + 公网入口）

桌面 app 形态的两个慢：本机 GUI 连远程引擎/电脑每轮有跨网络开销；人机交互绑在 VNC/本机窗口。最终形态：**服务器上跑 headless serve，人从任何浏览器/手机/桌面客户端直连** — 引擎、docker、桌面同机，零检查开销。实测 trivial turn 从 88s → 5s。

## 步骤

### 1. 公网入口

instabox：`npx -y instabox@latest port publish <盒子名> 8799` → 得到 `https://<id>.instabox.tech`（盒子运行期有效；HTTP 请求会自动唤醒暂停的盒子）。
普通 VPS：用 serve 的 `--domain HOST`（自带 Caddy 证书 — **前提：80/443 对公网可达，先验：`curl -I http://<域名>` 通且防火墙/安全组放行，否则证书签发失败**）/ `--tunnel`（Cloudflare，免开端口）/ `--public-url https://你已有的反代`。

### 2. 装 Node 24 + 全局 CLI

serve 由 openmausbot CLI 提供，要求 Node ≥24。instabox 模板自带 Node 22 在 `/usr/local/bin` 会挡住 apt 装的 Node 24（`/usr/bin`）→ 一切命令前置 `export PATH=/usr/bin:$PATH`。

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/ns.sh && sudo -E bash /tmp/ns.sh && sudo apt-get install -y nodejs
npm config set prefix ~/.npm-global && npm i -g openmausbot   # 全局装到 /usr 会 EACCES，规范做法用用户前缀
export PATH="$HOME/.npm-global/bin:/usr/bin:$PATH"
```

### 3. 停桌面 app，改好配置再启动

先停旧形态（二选一，不能并存）：`pkill -f /opt/OpenMausBot/openmausbot`。趁停把 bots.json 模型选择、config.json instances/imageGen/everyBotRules 全部改好（见阶段 3/6/7），serve 一次带全。**instabox 盒子 HOME=/data/home**，systemd 单元里的路径记得对应替换（模板有注释）。

### 4. 启动 serve

```bash
nohup env PATH="$HOME/.npm-global/bin:/usr/bin:$PATH" \
  openmausbot serve --port 8799 --public-url "https://<你的公开URL>" --no-open \
  > ~/.openmausbot-serve.log 2>&1 &
```

日志确认三件事：`server on http://127.0.0.1:8799`、`Reach <公开URL> ✓ answers as this server`、`local requests: owner trust`。数据目录与桌面 app 相同（~/.openmausbot）→ GLM 实例、bots、聊天记录全保留。

### 5. systemd 守护（模板 scripts/openmausbot-serve.service）

```ini
[Service]
User=<盒子用户>
Environment=PATH=/home/<user>/.npm-global/bin:/usr/bin:/usr/local/bin:/usr/bin:/bin
Environment=HOME=/home/<user>
ExecStart=/home/<user>/.npm-global/bin/openmausbot serve --port 8799 --public-url <URL> --no-open
Restart=on-failure
```

先 pkill 手动起的进程再 `systemctl enable --now`。开机自启 + 崩溃 5 秒拉起。

### 6. 配对接入（用户侧）

```bash
openmausbot pair --label main --ttl 24h
# 输出: 配对码 XXXX-XXXX-XXXX + 链接 https://<公开URL>/pair#code=...
```

serve 自启场景下本机命令即 owner，**免点卡**（桌面 app 形态才需要在 app 里点 Allow）。三种接法：
- 浏览器：打开公开 URL → 输配对码 → 完整聊天 UI
- 桌面客户端：＋ → Connect to a server → 粘贴链接
- 手机：MausBot App 扫 pair 输出的二维码
配对码单次有效；用完随时再 `pair`。长期免打扰可给固定成员开 `openmausbot access add <email>`。

### 7. 延迟验证（盒子内自测）

**前置：工作区里要有 bot** — `openmausbot bots` 查看；全新工作区没有就先 `openmausbot new-bot`（见 references/5）。

```bash
START=$(date +%s)
OUT=$(openmausbot send <bot> "只回复两个字:好的" | grep -oE "thread [0-9a-f-]{36}" | awk '{print $2}')
openmausbot wait --thread "$OUT" > /dev/null
echo "$(( $(date +%s) - START ))s"     # 全局安装 CLI 后应 ≤10s（npx 方式多 ~7s 解析开销）
```

浏览器端流式输出体感更快（首 token 2-4 秒即出字）。

## 坑录

| 坑 | 处理 |
|----|------|
| npx 每次解析包 ~7s | `npm i -g` 全局装（用户前缀）后用裸命令 |
| Node 22 挡 Node 24 | 所有命令 PATH=/usr/bin 前置；systemd 里 Environment=PATH 写全 |
| npm i -g EACCES | `npm config set prefix ~/.npm-global`，别动 /usr |
| serve 与桌面 app 抢 8799/数据锁 | 二选一；换形态先 pkill 旧的 |
| --public-url 校验失败 | 先起 serve 再验证；确认 port publish 已生效、URL 拼写对 |
| 公开 URL 谁都能看到登录页 | 无配对码进不去聊天；敏感场景加 `access add` 白名单或改 private |

## free plan 残余延迟（要向用户说清）

盒子空闲 30 分钟自动暂停：下次访问首条消息要等唤醒（几秒到十几秒），之后恢复秒级。连续 ~120 分钟运行到期限暂停 + 5-20 分钟冷却。升级付费计划（Pro 起）可关。桌面 VNC 上那个旧 app 不再需要；盒子桌面（Xvnc XFCE）仍可另作他用。
