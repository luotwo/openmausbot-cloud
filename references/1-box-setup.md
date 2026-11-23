# 阶段 1：instabox 盒子创建

## 登录检查

```bash
npx -y instabox@latest whoami     # 已登录会显示账号和计划；未登录走登录流程
```

- 有浏览器：`npx -y instabox@latest login`（设备码页面）
- 无浏览器/agent 场景：`npx -y instabox@latest login --agent`（打印 claim 页 + 码，转告用户批准，命令自动完成）

## 创建盒子

```bash
npx -y instabox@latest ls                      # 先查配额！
npx -y instabox@latest create --name openmausbot
```

- 默认模板 `agent-browser`（Debian 13 + 桌面 Xvnc + Chromium + Docker + claude/codex CLI 预装，4 vCPU / 8 GB）— 跑 OpenMausBot 就用它
- **免费计划配额 1 个盒子**：`quota_exceeded` 时列出旧盒子，**必须让用户确认**才能删除（`instabox rm --yes <名>` 删除不可恢复）
- 免费计划固定：空闲 30 分钟自动暂停（任何 exec/SSH/HTTP 请求自动唤醒）、单次运行 ~120 分钟后冷却。`--auto-suspend` 自定义值免费计划会拒（spec_not_allowed），别试

## 盒子基本盘

- 盒子用户：本机用户名映射（如 Windows `Administrator` → 盒子 `administrator`）；老盒子是 `user`/`dev`
- HOME = `/data/home`（持久盘 20G，挂载在 `/data`）；系统盘 16G（不能扩）。**所有 `~/.openmausbot` 绝对路径都是 `/data/home/.openmausbot`**
- 盒子用户自带免密 sudo（模板默认）；若 sudo 需密码，先 `sudo -v` 验证再跑长命令
- 桌面：Xvnc `:1` + XFCE4（X11），Dashboard → Computer 标签页可看
- 操作通道：`npx -y instabox@latest exec openmausbot -- '<cmd>'`（注意复杂命令的引号坑，见 SKILL.md 红牌 3）

## 普通非 instabox VPS 差异

无此阶段。直接 SSH 进 VPS（Debian/Ubuntu x86_64 即可），后续阶段全部适用；公开入口不用 `port publish`（那是 instabox 特性），用 openmausbot serve 的 `--domain` / `--tunnel` / 自备反代。
