# Echomere Agent Local

这是元见 Agent 的本地优先实现。项目默认使用 Mock 模型和 Mock 工具，也可通过环境配置切换到 DeepSeek/OpenAI-compatible 模型和 Echomere Backend 真实档案数据。本地项目不包含 GitHub 远程仓库配置。

## 已完成能力

- 稳定的 `AgentInput`、`AgentEvent`、`AgentResult` 契约
- 可验证的 Agent 状态机
- 可替换的 `LLMProvider` 接口
- 本地 `MockLLMProvider`
- 内存运行记录与 `clientRequestId` 幂等
- CLI 事件流演示
- 单元测试和类型检查
- 看运、问事、倾听、随缘四种模式策略
- 随缘模式的确定性意图路由
- 事业、财富、感情、健康、学业、家庭、决策和情绪主题识别
- 每次运行生成可审计的分析计划、时间范围和回答结构
- 档案快照、时间流和卦象标准工具接口
- 看运只在涉及年、月、时机或运势时读取时间流
- 看运缺少档案时进入 `waiting_input`
- 模糊问事先请求具体问题，不直接起卦
- 同一问事对话复用一个卦象
- 倾听模式禁止调用命理工具
- DeepSeek/OpenAI-compatible 真实流式模型 Provider
- 模型超时、取消、HTTP 错误和 usage 标准化
- 丢弃供应商返回的 `reasoning_content`
- 没有密钥时自动回退到 Mock
- SQLite 持久化 AgentRun、ToolRun、Conversation 和 Message
- 问事卦象跨进程、跨重启复用
- 本地 HTTP/SSE 服务和断线取消
- 最近 8 条、最多 12,000 字符的可控多轮上下文
- 同一对话锁定执行模式，`suiyuan` 会沿用已锁定模式
- 运行级 Prompt 版本和上下文快照，可追溯历史消息、工具证据与安全分类
- 模型之前的代码级安全闸门：自伤/暴力危机直接截断工具和模型调用
- 医疗、法律、金融和 Prompt Injection 风险标记与限制指令
- 输出泄露和命理确定性断言校验
- 命理回答的依据/解释/行动/不确定性分层协议
- 回答质量分和细分检查项，跟随 AgentRun 存档并写入 Backend 审计记录
- 首稿在质量校验前不对用户展示，低质量回答可自动重写并保留每次质量审计
- 命理模式可见风险提示与工具/模型失败的安全中文降级
- Echomere Backend HTTP Client 和标准化错误映射
- 真实 Profile/八字盘和流年数据 Adapter
- Bearer Token 从 Agent HTTP 请求头透传到后端，不写入运行记录
- 六爻工具独立端点契约与后端真实调用
- `X-Agent-Secret` 服务间鉴权，健康检查保持公开
- 后端 `/api/chat/stream` 代理和完整双服务联调
- Backend Prisma 作为正式对话历史源，当前用户消息不会重复进入模型上下文
- 真实后端模式不再把产品消息重复写入 Agent SQLite
- `X-Request-Id` 跨 Backend、Agent 和工具调用的端到端追踪
- Agent 全局和单用户并发保护
- 完整模型输入的字符预算保护
- 仅在零输出时重试可恢复的模型故障
- 安全的 `/api/runtime` 模型和运行策略查询
- Prometheus 模型 Token 与重试计数器
- 独立 `/health` 存活检查和 `/ready` 就绪检查
- 覆盖四模式、主题、时间范围和按需工具的可机读回归报告
- JSON 结构化请求/运行日志与敏感字段脱敏
- Prometheus HTTP、运行终态和并发拒绝指标
- 生产环境配置校验和超时优雅停机
- Agent 容器镜像与存活检查

## 本地运行

```bash
npm install
npm run check
npm test
npm run eval
npm run agent -- --mode qingting --message "最近工作压力很大"
npm run agent -- --mode kanyun --message "看看今年的事业运"
npm run agent -- --mode wenshi --message "我该不该接受这份工作？"
npm run agent -- --mode suiyuan --message "最近压力很大，想找人聊聊"
```

运行时使用 Node.js 24 的原生 TypeScript 支持，因此 CLI 和测试不依赖额外的 TypeScript 执行器。

## 接入真实模型

复制本地配置文件，并只在本机填写密钥：

```bash
cp .env.example .env.local
```

DeepSeek 配置：

```dotenv
LLM_PROVIDER=deepseek
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=在本地填写
LLM_MODEL=deepseek-v4-flash
LLM_TIMEOUT_MS=60000
LLM_MAX_TOKENS=2048
LLM_THINKING=disabled
LLM_REASONING_EFFORT=high
```

`LLM_REASONING_EFFORT` 只在 `LLM_THINKING=enabled` 时生效，可选 `low` / `high` / `max`。当前 DeepSeek 模型和思考参数以 [DeepSeek 官方文档](https://api-docs.deepseek.com/quick_start/pricing/) 为准。

`.env.local` 已被 `.gitignore` 排除。没有有效 `LLM_API_KEY` 时，Provider 工厂会自动使用 Mock，不会误发真实请求。配置新密钥后，先运行不产生对话的模型列表诊断：

```bash
npm run llm:check
```

诊断会检查连接、凭据和 `LLM_MODEL` 是否可用，但不打印 API Key。

切换其他 OpenAI-compatible 服务时无需修改 Agent：

```dotenv
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://provider.example.com/v1
LLM_API_KEY=在本地填写
LLM_MODEL=provider-model-name
```

### 命名模型配置档案

需要在多个模型间切换时，复制示例文件：

```bash
cp config/model-profiles.example.json config/model-profiles.local.json
```

配置文件只保存 Provider、模型名和 `apiKeyEnv` 环境变量名，不保存真实 Key。然后在 `.env.local` 选择活动档案：

```dotenv
LLM_PROFILES_FILE=config/model-profiles.local.json
LLM_ACTIVE_PROFILE=deepseek-flash
LLM_API_KEY=对应档案引用的本地密钥
```

运行 `npm run models` 可查看已配置档案及当前激活项，输出不包含 Key 和 Base URL。`npm run llm:check` 会检查当前激活档案。不配置 `LLM_PROFILES_FILE` 时，仍完全兼容原有单组 `LLM_*` 环境变量。

本地开发可启用运行时热切换：

```dotenv
AGENT_RUNTIME_MODEL_SWITCH_ENABLED=true
AGENT_RUNTIME_MODEL_SWITCH_MODE=local
AGENT_RUNTIME_MODEL_SELECTION_PATH=./data/runtime-model-profile.json
AGENT_RUNTIME_MODEL_SWITCH_VALIDATION_TIMEOUT_MS=10000
```

切换前 Agent 会通过 Provider `/models` 端点验证凭据和模型名，通过后再原子替换 Provider，并只持久化档案 id。已经开始的请求继续使用旧 Provider，新请求才使用新模型。生产环境需使用受控的 `service` 模式，详见 [生产模型切换运行手册](./docs/production-runtime-model-control.md)。

## 启动本地 Agent 服务

```bash
npm run server
```

默认监听 `127.0.0.1:4310`，数据库保存在 `./data/agent.db`。当前仅提供服务间共享密钥，不应直接绑定公网地址。

生产启动使用带预检的命令：

```bash
npm run production:check
npm run server:production
```

生产预检只输出脱敏摘要。密钥、持久化绝对路径、Redis、Backend 工具数据源、模型档案或 service 切换确认不合格时，服务不会启动。

与 Backend 联调时应设置服务间密钥：

```dotenv
AGENT_SHARED_SECRET=与后端完全一致的高强度密钥
```

设置后，所有 `/api/*` 请求都必须携带 `X-Agent-Secret`；`/health` 不受影响。

运行保护配置：

```dotenv
AGENT_MAX_CONCURRENT_RUNS=8
AGENT_MAX_CONCURRENT_RUNS_PER_USER=2
AGENT_MAX_MODEL_INPUT_CHARACTERS=32000
AGENT_MAX_PROVIDER_RETRIES=1
AGENT_MAX_QUALITY_REWRITES=1
AGENT_PROVIDER_RETRY_BASE_DELAY_MS=500
AGENT_PROVIDER_RETRY_MAX_DELAY_MS=4000
AGENT_CONCURRENCY_STORE=memory
AGENT_METRICS_TOKEN=至少32字符的独立监控密钥
LOG_LEVEL=info
SHUTDOWN_TIMEOUT_MS=30000
```

本地单进程使用 `AGENT_CONCURRENCY_STORE=memory`。多个 Agent 实例必须共享 Redis：

```dotenv
AGENT_CONCURRENCY_STORE=redis
REDIS_URL=redis://redis:6379
AGENT_CONCURRENCY_LEASE_TTL_MS=180000
AGENT_CONCURRENCY_REDIS_PREFIX=echomere:agent-runs
AGENT_CONCURRENCY_REDIS_TIMEOUT_MS=2000
```

Redis 模式使用原子租约，同时约束全局和单用户并发。租约会定时续期、正常结束主动释放；实例崩溃后会按 TTL 自动回收。续租失败会中断对应模型运行，避免失去并发保护后继续消耗资源。

健康检查：

```bash
curl http://127.0.0.1:4310/health
curl http://127.0.0.1:4310/ready
curl http://127.0.0.1:4310/api/runtime \
  -H "X-Agent-Secret: $AGENT_SHARED_SECRET"

curl -X POST http://127.0.0.1:4310/api/runtime/profile \
  -H "X-Agent-Secret: $AGENT_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"profileId":"deepseek-pro"}'
```

Prometheus 指标：

```bash
curl http://127.0.0.1:4310/metrics \
  -H "Authorization: Bearer $AGENT_METRICS_TOKEN"
```

指标覆盖 HTTP 请求数/耗时、活跃请求、活跃运行，以及完成、失败、中断、等待补充、并发拒绝和并发存储不可用六种运行结果；还会记录模型输入/输出 Token、零输出 Provider 重试、质量重写和重写后仍未达标的完成数。日志使用 JSON Lines，并自动脱敏 Token、Secret、Cookie 和 API Key 字段。

`AGENT_MAX_MODEL_INPUT_CHARACTERS` 在请求发送给模型前，对系统提示、历史、工具上下文和当前问题的完整字符数执行上限检查。模型传输重试仅适用于可恢复故障且 Provider 没有返回内容的情况。质量重写是独立流程：Agent 先缓冲首稿，通过结构、依据、行动建议和不确定性检查后才流式返回；未通过时最多按 `AGENT_MAX_QUALITY_REWRITES` 重写 0–2 次。Token usage 会累加所有完整草稿的消耗。`/api/runtime` 不返回 API Key 或 Provider URL。未启用本地热切换时，修改 `LLM_ACTIVE_PROFILE` 后重启 Agent 即可切换模型。

当 `NODE_ENV=production` 时，Agent 会拒绝 Mock 模型、Mock 工具、内存数据库、弱服务密钥或未保护的指标端点。收到 `SIGINT`/`SIGTERM` 后会等待在途流式运行结束；超过 `SHUTDOWN_TIMEOUT_MS` 才强制断开。

工作区根目录已提供 `docker-compose.production.yml` 和 `deploy/production/` 单 Agent 生产模板。容器使用非 root 用户、只读根文件系统、持久化命名卷和 `/ready` 健康检查；Agent 与 Redis 均不发布宿主机端口。

发起 SSE Agent 请求：

```bash
curl -N http://127.0.0.1:4310/api/agent/stream \
  -H "X-Agent-Secret: $AGENT_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "local-user",
    "conversationId": "conversation-001",
    "clientRequestId": "request-001",
    "mode": "suiyuan",
    "message": "最近压力很大，想找人聊聊"
  }'
```

读取持久化对话：

```bash
curl "http://127.0.0.1:4310/api/conversations/conversation-001?userId=local-user" \
  -H "X-Agent-Secret: $AGENT_SHARED_SECRET"
```

读取运行和工具记录：

```bash
curl "http://127.0.0.1:4310/api/runs/by-request/request-001?userId=local-user" \
  -H "X-Agent-Secret: $AGENT_SHARED_SECRET"
```

CLI 每行输出一个 JSON Agent 事件，便于以后原样转换成 SSE。

## 连接 Echomere Backend

```dotenv
AGENT_TOOLS_PROVIDER=echomere-backend
ECHOMERE_BACKEND_URL=http://127.0.0.1:3001
ECHOMERE_BACKEND_TIMEOUT_MS=10000
```

向 Agent HTTP 服务请求时，携带当前用户的后端 JWT：

```bash
curl -N http://127.0.0.1:4310/api/agent/stream \
  -H "Authorization: Bearer <backend-user-jwt>" \
  -H "X-Agent-Secret: $AGENT_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<backend-user-id>",
    "clientRequestId": "request-001",
    "mode": "kanyun",
    "message": "2027 年事业怎么样？"
  }'
```

完整拓扑、现有端点映射、六爻工具端点契约和持久化边界见 [Backend × Agent 接入契约](./docs/backend-integration-contract.md)。

## 命理工作流模型回归

默认使用 Mock Provider，不读取或消耗真实 API Key：

```bash
npm run eval
```

更换为新生成的模型密钥后，才显式运行：

```bash
npm run llm:check
npm run eval -- --live
```

报告使用 8 个场景检查终态、路由、主题、时间范围、按需工具、输出长度、Prompt 版本和最终回答质量，并记录质量重写次数，不输出 API Key。详见 [模型回归说明](./docs/model-regression.md)。

## 当前边界

默认 `AGENT_TOOLS_PROVIDER=mock`，此时输出会明确标记为 Mock。使用 `--without-profile` 可验证看运模式的缺档案分支。切换到 `echomere-backend` 后，看运可读取后端真实档案和排盘，问事会调用后端独立六爻工具端点并复用同对话卦象。

当前安全检测是可测试的本地防御基线，不是经过临床或合规认证的完整安全系统。上线前仍需要后端鉴权、限流、审计、人工升级和按服务地区配置的紧急资源。

## 后续集成

Agent 工具 Adapter、后端六爻端点、SSE 代理、幂等写库、Backend 正式历史、请求追踪、Redis 分布式限流/并发保护、结构化日志、指标监控、优雅停机、前端联调、证据驱动命理工作流、低质量回答自动重写、多模型档案、受控热切换和单 Agent 通用生产部署包已完成。下一步是带用户授权、可查看与可删除的长期记忆/画像，以及更大的真实对话评测集；再选定部署平台配置域名、HTTPS、备份和线上 Secret。
