# 生产模型切换运行手册

该控制面不需要数据库 migration。Backend 负责用户管理员授权和操作审计，Agent 只接受共享密钥保护的服务间请求，并在切换前验证目标 Provider。

## 部署边界

- Agent 只能暴露在 Backend 可访问的私网，禁止将 `/api/runtime/profile` 直接暴露到公网。
- Backend 和 Agent 必须配置完全相同、至少 32 字符的 `AGENT_SHARED_SECRET`。
- 模型档案文件只保存 `apiKeyEnv` 名称，真实 Key 使用部署平台 Secret 注入。
- 当前选择文件是单 Agent 实例或单写共享卷设计。在实现 Redis/数据库共享选择与广播前，不得让多个 Agent 副本同时接受切换。

## Agent 环境变量

```dotenv
NODE_ENV=production
AGENT_HOST=0.0.0.0
AGENT_SHARED_SECRET=<32 字符以上的私密值>
LLM_PROFILES_FILE=/data/model-profiles.json
AGENT_RUNTIME_MODEL_SWITCH_ENABLED=true
AGENT_RUNTIME_MODEL_SWITCH_MODE=service
AGENT_RUNTIME_MODEL_SWITCH_SERVICE_CONFIRM=private-network
AGENT_RUNTIME_MODEL_SELECTION_PATH=/data/runtime-model-profile.json
```

`service` 模式缺少任一确认项时 Agent 都会拒绝启动。生产选择路径必须是 `/tmp` 之外的绝对持久化路径。

## Backend 环境变量

```dotenv
NODE_ENV=production
AGENT_RUNTIME_MODEL_CONTROL_ENABLED=true
AGENT_RUNTIME_MODEL_ADMIN_EMAILS=admin@example.com,ops@example.com
```

邮箱会规范化为小写后精确匹配。白名单不会返回给前端；非管理员仍可查看已脱敏运行状态，但界面为只读且 POST 返回 403。

## 发布和回滚

1. 先在预发环境运行 `npm run llm:check` 和四模式真模型回归。
2. 先部署 Agent 并确认 `/ready`，再部署 Backend，最后开启 Backend 控制开关。
3. 切换后检查 `runtime_model_switch_audit` 日志和 `echomere_backend_runtime_model_switches_total` 指标，再发起一个新对话做冒烟测试。
4. 回滚时在同一管理页切回上一档案；若 Provider 校验不可用，修改 `LLM_ACTIVE_PROFILE` 后重启 Agent。
5. 紧急关闭时设置 Backend `AGENT_RUNTIME_MODEL_CONTROL_ENABLED=false`，不影响当前模型继续提供对话。

Backend 审计记录仅保存用户 ID、请求 ID、目标档案、结果和错误代码，不保存管理员邮箱、Token 或 API Key。
