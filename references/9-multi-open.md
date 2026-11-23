# 阶段 9：Windows 客户端多开（累加式，升级安全）

让 Windows 桌面客户端可以任意多开：每运行一次多开器，**新增**打开一批客户端（默认 3 个/批），每个是独立工作区可配对不同服务器。主安装升级完全不受影响。

## 一键部署（其他电脑）

工具包在 skill 目录 `multi-open-windows/`（或 GitHub 仓库同名目录）。前提：OpenMausBot 桌面版（默认路径安装）+ Node.js。双击 `install.cmd` 完成。

## 架构（升级安全的关键设计）

```
主安装 C:\...\Programs\openmausbot    【一个字节不动 → 官方自动升级正常】
副本   <数据盘>\OpenMausBot-Multi      resources\app\（解包目录形态，Electron 优先加载）
        + userData 分叉 %APPDATA%\OpenMausBot-Multi-<N>（锁作用域分离 + Chromium 缓存独立）
        + app-update.yml 已删（禁自更新，版本永远跟随主安装）
启动器  每次启动对比主安装 app.asar 指纹（size_mtime）→ 变了就自动重建副本+重打补丁
```

关键点：
- Electron 单实例锁基于 userData 路径 — `--user-data-dir` 开关**绕不开**（实测），必须 `app.setPath("userData", ...)` 补丁
- 副本用**解包目录形态**（`resources\app\` 优先于 app.asar 加载）— 纯文本打补丁，不碰 asar 二进制
- 端口表补丁：内置 `[8799,18799,28799]` 太少，扩到 `[8799..118799]` 共 12 个 → 最多 12 实例

## 踩过的坑（重申）

| 坑 | 处理 |
|----|------|
| 实例同时启动端口竞态：健康检查把别的实例启动中的端口误判 stuck-child → abort 整批 | **错峰启动，每个间隔 10s**（open-multi.mjs 已内置）|
| webhook 端口 = 主端口 + 1，实例间也会撞 | 错峰启动顺带解决 |
| `--user-data-dir` 不改锁作用域 | setPath userData 补丁 |
| robocopy 退出码 0-7 是成功 | execFileSync 会抛异常，必须 catch 判断 |
| .mjs（ESM）没有 `__dirname` | `path.dirname(fileURLToPath(import.meta.url))` |
| cmd 批处理写中文注释/含空格的 `%~tF` 指纹会炸 | 逻辑全放 node，cmd 只留两行 |

## 文件与入口

- 编排器：`open-multi.mjs`（数量记忆 count.txt + 累加 next-id.txt + 错峰）
- 构建器：`build-multi.mjs`（同步 + 补丁；副本目录自动选盘 `pickCopyDir()`，`OMB_COPY_DIR` 可覆盖）
- 入口：`OpenMausBot-Multi.cmd`（无参 = 批模式；带 N = 单开实例 N）、`set-count.cmd`（改每批数量）
- 每实例工作区：`~/.openmausbot-multi-<N>`；userData：`%APPDATA%\OpenMausBot-Multi-<N>`

## 限制

- 仅 Windows（macOS/Linux 客户端多开需另写对应启动器，锁原理相同）
- ≤12 实例（端口表上限，可再扩）；内存 ~500MB/实例
- 新实例 = 全新工作区（首次 onboarding + 配对）；同工作区多窗口请直接开浏览器访问 server 端口（只读），或等官方多窗口支持
