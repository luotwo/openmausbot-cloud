# 阶段 3：接入 GLM / 自定义引擎（instances）

OpenMausBot 的 bot 跑在「引擎实例」上。内置 claude/codex/grok CLI 引擎之外，任何 OpenAI 兼容端点都能通过 `openai-compat` driver 接入 — 智谱 GLM、Z.ai、DeepSeek、Qwen、本地 vLLM 等都走这条路。

## 配置位置

`~/.openmausbot/config.json` 的 `instances` 块（文件 0600 权限）。**改完必须重启 app/serve**（instance 条目只在启动时读取）。

## GLM 配置（官方文档原生支持）

```json
{
  "instances": {
    "glm": {
      "driver": "openai-compat",
      "displayName": "GLM (智谱)",
      "environment": { "GLM_API_KEY": "<你的key>" },
      "config": {
        "url": "https://open.bigmodel.cn/api/paas/v4",
        "apiKeyEnv": "GLM_API_KEY",
        "model": "glm-5.3"
      }
    }
  }
}
```

- 国内 BigModel：`https://open.bigmodel.cn/api/paas/v4`；国际 Z.ai：`https://api.z.ai/api/paas/v4`
- driver 自动在 url 后拼 `/chat/completions`，并尝试 `/models` 发现
- key 存 config.json 明文（0600 保护）— 不要提交进任何仓库

## 编辑方式（按场景选）

**新部署/没跑 serve**：直接改文件 → 启动。

**已在跑、本机能 curl 到 API**：REST 更稳（不用重启前担心格式）：
```bash
curl -X PATCH http://127.0.0.1:8799/api/config \
  -H "Authorization: Bearer <admin token>" \
  -H "Content-Type: application/json" \
  -d '{"instances": {...}}'
```
（token 获取见 references/5；改 instances 后仍建议重启）

**远端盒子、手上有 exec 通道**：本地写好 python 合并脚本 → push → 执行（绝不内联嵌套引号命令）。参考合并逻辑：

```python
import json
p = "/data/home/.openmausbot/config.json"
d = json.load(open(p))
d.setdefault("instances", {})["glm"] = {...}   # 见上
json.dump(d, open(p, "w"), ensure_ascii=False, indent=2)
```

## 切换某个 bot 用新引擎

bot 的模型选择存在 `~/.openmausbot/bots.json` 的 `modelSelection`（bot 级 + 每个 task 一份）。停服务 → python 改 → 启动：

```python
b["modelSelection"] = {"instanceId": "glm", "model": "glm-5.3"}
for t in b.get("tasks", []): t["modelSelection"] = {"instanceId": "glm", "model": "glm-5.3"}
```

UI 路径：bot 的模型选择器 → 选 GLM → Refresh models 拉取该 key 可用模型列表。

## 验证

先 curl 端点验 key（免费快速）：
```bash
curl -X POST "https://open.bigmodel.cn/api/paas/v4/chat/completions" \
  -H "Authorization: Bearer <key>" -H "Content-Type: application/json" \
  -d '{"model":"glm-5.3","messages":[{"role":"user","content":"回复:OK"}],"max_tokens":10}'
```
再看重启后的引擎状态：`~/.openmausbot/providers/engine-status.json` 应有 `"state": "available", "authenticated": true`。

## 引擎图标

host 识别自动显示（api.deepseek.com→DeepSeek 等）；bigmodel/z.ai 无专属图标走默认，可手动 `"icon": {"kind": "preset", "preset": "qwen"}` 等（预设含 OpenAI/Anthropic/DeepSeek/Qwen/Moonshot 等）。

## 普通非 instabox VPS 差异

无差异（config 在同一相对路径）。若 bot 连国内 API 而服务器在海外，直连即可（bigmodel 海外可达）；反过来海外 API 从国内连才需要代理 — 代理只在进程内注入，见红牌 1。
