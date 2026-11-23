# OpenMausBot 多开（Windows）

每双击一次「多开」= 新增打开一批 OpenMausBot 客户端（数量自定、累加式）。每个客户端是独立工作区，可分别配对不同服务器（本地 / 云端 serve / 其他）。**主安装升级完全不受影响**（副本自动跟随重建）。

## 其他电脑安装（3 步）

1. 装好 [OpenMausBot 桌面版](https://github.com/milind-soni/OpenMausBot/releases/latest/download/OpenMausBot-setup.exe)（默认路径安装）
2. 装 Node.js：`winget install OpenJS.NodeJS.LTS`（装过跳过）
3. 双击本目录的 **`install.cmd`** → 桌面出现「OpenMausBot-多开」快捷方式 → 完成

## 使用

| 操作 | 结果 |
|------|------|
| 双击「OpenMausBot-多开」| 首次弹窗问每批数量（建议 3，记住）→ 新增打开一批 |
| 再双击一次 | 再新增一批（实例编号累加，永不冲突）|
| 双击「多开-设置数量」| 重新弹窗改每批数量 |

每个新客户端首次进入走 onboarding → ＋ → Connect to a server 配对你的服务器。

## 特性

- **升级安全**：主安装（C 盘）永不改动，官方自动升级正常；多开副本自动跟随主安装版本重建（升级后下次点击自动重建，约 1 分钟）
- **自动选盘**：副本放第一个可用数据盘（可用环境变量 `OMB_COPY_DIR` 指定目录）
- **端口自动错开**：每实例独立端口（8799 起，已扩容到 12 个实例上限，错峰启动防竞态）
- 内存约 500MB/实例，注意别开太多

## 文件清单

| 文件 | 用途 |
|------|------|
| `install.cmd` / `install.mjs` | 一键安装器（拷工具 + 建快捷方式）|
| `open-multi.mjs` | 编排器：数量记忆 + 累加开批 + 错峰启动 |
| `build-multi.mjs` | 副本构建：主安装同步 + userData 分叉补丁 |
| `OpenMausBot-Multi.cmd` | 单实例启动（`OpenMausBot-Multi.cmd N` 开实例 N）|
| `set-count.cmd` | 重新弹窗改每批数量 |

## 故障排查

- 双击后报「副本重建失败」→ 关闭所有 OpenMausBot 窗口再点一次（文件被占用）
- 某实例窗口显示错误页 → 关掉那个窗口，重新双击多开（实例编号会自动跳过）
- 「未找到主安装」→ OpenMausBot 没装或装到非默认路径
