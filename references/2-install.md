# 阶段 2：安装 OpenMausBot（Linux）

## 获取安装包

官方 release 提供稳定命名直链（不用查版本号）：

```bash
curl -fSL -o /tmp/OpenMausBot-amd64.deb https://github.com/milind-soni/OpenMausBot/releases/latest/download/OpenMausBot-amd64.deb
```

文件 ~280 MB。建议在目标机器上直接下载（盒子网络通常比本地→推上去快），放 `/tmp` 装完删。大文件下载用后台任务防超时：

```bash
npx -y instabox@latest exec --background openmausbot -- 'curl ... && ls -la /tmp/*.deb'
npx -y instabox@latest jobs wait openmausbot <jobId> --timeout 8m
```

## 安装（apt 自动解析桌面依赖）

文档面向 Ubuntu 24.04，实测 Debian 13 完全可用，apt 会自动补齐 libsecret/libxss/apparmor 等。盒子用户自带免密 sudo（若不确定先 `sudo -v` 验证，避免长命令中途卡在密码提示）：

```bash
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/OpenMausBot-amd64.deb
```

装完清理：`rm -f /tmp/*.deb`

## 验证

```bash
ls /opt/OpenMausBot/openmausbot                    # 二进制
dpkg -l openmausbot | tail -1                      # 包记录
ls /usr/share/applications/ | grep -i maus         # 桌面入口 com.openmausbot.app.desktop
```

## 启动（桌面 app 形态，仅验证/临时用）

盒子桌面是 Xvnc `:1` + XFCE（X11）。后台启动（输出必须重定向文件，否则后台进程写 exec 的 stdout 会断管）：

```bash
DISPLAY=:1 nohup /opt/OpenMausBot/openmausbot > ~/.openmausbot-launch.log 2>&1 &
```

窗口验证：`DISPLAY=:1 xwininfo -root -tree | grep -i mausbot` 应看到 1040x760 窗口。

日志里的 `NODE_OPTIONs not supported` 和 `login1 Inhibit AccessDenied` 是无害噪音。

## 两种形态的选择

- **桌面 app**：GUI 在 VNC 桌面里，Dashboard → Computer 操作。适合先验证安装。
- **headless serve**（推荐长期主力）：无 GUI，浏览器/手机远程直连，配对码接入，systemd 守护。见 references/8-headless-serve.md。两者共用同一 `~/.openmausbot` 数据目录，**不能同时跑**（端口和数据锁冲突）。

## 普通非 instabox VPS 差异

完全一致。没有 VNC 桌面就不需要 DISPLAY 启动那步 — 直接上 serve 形态（阶段 8）。
