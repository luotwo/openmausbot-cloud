# openmausbot-cloud

在云主机（instabox 盒子或任意 Debian/Ubuntu VPS）上从零部署 **OpenMausBot** 并接入完整生成能力的 Claude Code skill。

## 能力覆盖

- **OpenMausBot 安装**：.deb 直装（Ubuntu 24.04 / Debian 13 实测）+ 桌面/serve 双形态
- **模型引擎**：智谱 GLM / Z.ai / 任意 OpenAI 兼容中转（`openai-compat` driver，instances 配置全模板）
- **图片生成**：apimart 等异步任务 API → 同步 b64_json 的本地 shim（纯 node 无依赖，15s 出图实测）
- **视频生成**：gen-video CLI 工具 + everyBotRules 全 bot 分发（52 模型，seedance/kling/veo/wan）
- **BYO-VPS**：把远程盒子变成本机 bot 的专属电脑（SSH token 别名 + Docker CLI + provision）
- **秒级迁移**：headless serve + systemd + 公网入口 + 配对码（实测 88s → 5s）

## 安装

```bash
# Claude Code skills 目录
git clone https://github.com/luotwo/openmausbot-cloud.git ~/.claude/skills/openmausbot-cloud
# 或直接复制 openmausbot-cloud.skill 解压到 ~/.claude/skills/openmausbot-cloud
```

重启 Claude Code 后，说「在新账号部署 OpenMausBot」「接入 GLM」「给 mausbot 加图片/视频生成」等即自动触发。

## 结构

```
SKILL.md                  # 触发条件 + 高危红牌(5) + 参数清单 + 8 阶段路由
references/1-8-*.md       # 每阶段详细步骤 + 坑录（全部真实踩过）
scripts/                  # 可直接部署的实战脚本（零密钥）
  ├── shim-server.mjs     #   图片异步转同步 shim
  ├── gen-video.mjs       #   视频生成 CLI
  ├── config.example.json #   两者共用配置模板（填 key）
  ├── start-shim.cmd      #   Windows 侧代理启动器
  └── *.service           #   systemd 单元模板 ×2
```

## 高危红牌（节选）

1. **绝不设全局 HTTPS_PROXY** — 会把走国内 API 的 claude CLI 塞进代理绕国际（实测 26s → 156s）
2. **instabox 免费计划三限**：1 盒子 / 空闲 30min 自动暂停 / 连续 ~120min 冷却
3. **Git Bash 推文件必须 `MSYS_NO_PATHCONV=1`**；复杂命令一律「写脚本 → push → 执行」
4. 图片通道只收内联 b64_json，URL 返回会被拒

## 来源

2026-11 在 instabox 免费盒子（Debian 13）+ OpenMausBot v0.1.177 的完整生产部署经验提炼。独立审查 10 项问题全部修复。
