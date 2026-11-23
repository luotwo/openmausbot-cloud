# 阶段 4：BYO-VPS — 把远程盒子变成本机 bot 的电脑

本机 OpenMausBot（Windows/Mac/Linux）把一台远程 Linux 服务器配置为 bot 的专属电脑：bot 每次干活在远程的独立容器桌面里进行，本机实时预览、可随时接管。原理：本机只装 Docker CLI，bot 动作经 `docker -H ssh://<别名>` 打到远程 dockerd。

## 前提（三件事缺一不可）

1. **本机 Docker CLI ≥ 18.09**（只要 CLI，不要 daemon）：Windows `winget install -e --id Docker.DockerCLI`；macOS `brew install docker`；Debian/Ubuntu `sudo apt install docker-ce-cli`
2. **远程机 dockerd 运行中 + SSH 用户在 docker 组**：`ssh <盒子> 'groups'` 输出含 docker。instabox agent-browser 模板自带 ✅；自己装的：`sudo usermod -aG docker <user>`
3. **本机 ~/.ssh/config 里的命名别名**（app 只认别名不认 IP）

## SSH 别名（关键：稳定长期凭证）

instabox 盒子的直连走网关 `ssh.instabox.sh`。两种方式：

**A. 长效 token（推荐，零维护）**：
```bash
npx -y instabox@latest ssh-token <盒子名> --ttl never
# 输出形如: ssh -p 2222 ibssh_xxx@ssh.instabox.sh
```
写入 ~/.ssh/config：
```
Host openmausbot
  HostName ssh.instabox.sh
  Port 2222
  User ibssh_xxx            # 整个 token 就是用户名，无需密钥
  ServerAliveInterval 15
  ServerAliveCountMax 3
  ConnectTimeout 30          # 留唤醒余量：盒子暂停后 SSH 连接会自动唤醒它
```
安全：token 等同密码。撤销：`instabox ssh-token --revoke <盒子名>`。

**B. 短期证书（`instabox ssh-config <名>` 输出 Host 块）**：证书过期需手动 `instabox ssh-cert <名>` 续 — 不适合无人值守。

**首次连接必须手动做一次**（host key TOFO，app 不会自动接受）：
```bash
ssh -o StrictHostKeyChecking=accept-new openmausbot true
```

## 验证通道（app 用的就是这两条）

```bash
docker -H ssh://openmausbot info     # 应输出 Server version / CPUs / 内存
```

## app 侧配置

程序化（推荐，见 references/5 拿 admin token）：
```bash
# 工作区默认服务器别名
curl -X PATCH http://127.0.0.1:8799/api/config -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" -d '{"vps":{"sshAlias":"openmausbot"}}'
# 把 bot 切到云电脑（ computer: "cloud" + cloudBackend: "vps"）
curl -X PATCH http://127.0.0.1:8799/api/bots/<botId> -H "Authorization: Bearer $T" \
  -H "Content-Type: application/json" -d '{"computer":"cloud","cloudBackend":"vps"}'
```
UI 路径：Settings → AI → Other services → Self-hosted VPS 填别名；bot 的 Computer 面板 → Cloud → Self-hosted VPS → Provision。

CLI 触发开通：`npx -y openmausbot@latest computers start <bot名>`（首次在远程构建 Cua 镜像，几分钟；之后秒起）。容器命名 `openmausbot-vps-<botId前缀>-<hash>`，健康检查 `docker ps` 看 `(healthy)`。

## 性能真相（提前告知用户）

每轮对话 app 都会检查容器（若干条 docker-over-ssh 命令）。**中国 → 美西网关 + Windows 无 ControlMaster 连接复用 = 每条命令 4-6 秒，每轮 +60 秒左右**。纯聊天用不带云电脑的 bot（快 3 倍以上）；要秒级响应把主力迁到盒子上的 serve（见 references/8）。

## 安全边界（要跟用户说清）

- bot 拿到的是远程机上 **docker 组 = root 等级** 的权限。给 bot 用专用机器，别放有敏感数据的资产。
- token 在 ~/.ssh/config 里明文 — 泄露即撤销重发。
- 容器文件易失：bot 在容器里的产出必须让它传回聊天，容器删除/镜像升级会清空。

## Windows 特别注意

- 无 wake 脚本机制（macOS/Linux 才有 `~/.openmausbot/ssh/wake`）；盒子长暂停后先 `instabox wake <名>` 再用。
- OpenSSH 无连接复用 — 上面性能真相的主因，无法绕过。

## 普通非 instabox VPS 差异

- 不用 instabox 网关/token：自备 SSH key，`ssh-keygen` + `ssh-copy-id user@VPS`，~/.ssh/config 写常规 Host 块（HostName=VPS IP、User、IdentityFile），ControlMaster 三件套按 OpenMausBot 官方模板加（macOS/Linux 有效，Windows 无效）
- 无 `instabox wake`（VPS 不会自动暂停）；其余全流程一致
- dockerd 安装：`curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker <user>`
