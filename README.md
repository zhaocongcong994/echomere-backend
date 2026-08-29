# Soothsayer Backend

MetaSight 的 Express API。后端负责用户、档案、产品对话和计费，并将聊天执行代理给独立的 Echomere Agent 服务。仓库自带 Prisma schema 和 SQLite migrations，可以独立构建和运行。

## 环境要求

- Node.js 20.9 或更高版本（推荐 Node.js 22 LTS）
- npm 10 或更高版本

## 本地运行

先启动 Agent，并确保两侧的 `AGENT_SHARED_SECRET` 完全一致：

```dotenv
AGENT_SERVICE_URL=http://127.0.0.1:4310
AGENT_CONNECT_TIMEOUT_MS=10000
AGENT_SHARED_SECRET=仅用于服务间调用的高强度密钥
```

再启动后端：

```bash
npm install
cp .env.example .env
npm run dev
```

首次启动会自动生成 Prisma Client 并初始化本地 SQLite 数据库。服务默认监听 `http://localhost:3001`，健康检查地址为 `http://localhost:3001/api/health`。

存活检查为 `GET /api/health`；就绪检查为 `GET /api/ready`，后者会同时验证 Prisma 数据库、Agent `/health` 和限流存储。任一依赖不可用时返回 `503 not_ready`。

LLM 配置已归 Agent 管理，后端聊天路由不再直接调用模型。Agent 不可用时，`/api/chat/stream` 会返回可识别的 SSE 错误事件。

## Agent 接入契约

`POST /api/chat/stream` 保留原前端的 SSE 事件形式，但内部已改为 Agent 代理。后端会：

- 从 JWT 确定用户，并验证对话所有权。
- 使用 `clientRequestId` 保证重试不重复写消息和计费。
- 把 Bearer Token 和 `X-Agent-Secret` 透传给 Agent。
- 将 Agent 事件转换为前端兼容的 `meta` / `chunk` / `tool` / `waiting_input` / `done` / `error` 事件。
- 仅在 Agent 完成后幂等地保存助手消息和计费记录。
- 用 Prisma 事务原子更新消息、对话计数和计费，并使用 `agentRunId` 防止并发重复计费。
- 为每个请求生成或接受 `X-Request-Id`，并透传至 Agent 和后端工具调用。
- 默认对每个用户限制每 60 秒 20 次聊天请求，超额返回 `429` 和 `Retry-After`。

Agent 问事工具使用 `POST /api/agent/tools/hexagram`。该端点需要用户 JWT，只接受当前用户的 `wenshi` 对话，并在同一对话内永久复用同一卦象。

### 受控模型切换

本地开发时，可在 Backend 显式启用设置页的模型切换代理：

```dotenv
AGENT_RUNTIME_MODEL_CONTROL_ENABLED=true
# 可选：本地不填时所有已登录用户可切换
AGENT_RUNTIME_MODEL_ADMIN_EMAILS=admin@example.com
```

`GET /api/agent/runtime` 返回已脱敏档案、`admin | read-only` 权限状态和切换能力，`POST /api/agent/runtime/profile` 接收 `{"profileId":"..."}`。两个端点都需要用户 JWT，Backend 再通过 `X-Agent-Secret` 访问 Agent。一旦配置管理员白名单，只有邮箱精确命中的用户可切换；生产开启时白名单为必填项。每次成功、拒绝和失败都会写入 `runtime_model_switch_audit` 结构化日志，且不记录邮箱或密钥。

单进程本地限流配置：

```dotenv
CHAT_RATE_LIMIT_MAX=20
CHAT_RATE_LIMIT_WINDOW_MS=60000
CHAT_RATE_LIMIT_STORE=memory
```

多实例部署使用 Redis 原子固定窗口：

```dotenv
CHAT_RATE_LIMIT_STORE=redis
REDIS_URL=redis://redis:6379
CHAT_RATE_LIMIT_REDIS_PREFIX=echomere:chat-rate
CHAT_RATE_LIMIT_REDIS_TIMEOUT_MS=2000
```

Redis 无法连接时聊天接口会失败关闭并返回 `503 CHAT_RATE_LIMIT_UNAVAILABLE`，就绪检查也会返回 `503`，不会静默退回单机限流。

## 日志与指标

服务以 JSON Lines 输出请求耗时、状态码、`requestId`、启动和停机事件，并对 Token、Secret、Cookie 等字段自动脱敏。日志等级通过 `LOG_LEVEL=debug|info|warn|error` 控制。

Prometheus 指标位于 `GET /api/metrics`，生产环境必须配置至少 32 字符的 `METRICS_TOKEN`，并使用 `Authorization: Bearer <token>` 读取。指标包含 HTTP 请求数/耗时、活跃请求、聊天限流数、模型切换结果和内部错误数。

收到 `SIGINT` 或 `SIGTERM` 后，服务停止接受新连接、关闭空闲连接，等待在途请求完成，再断开 Redis 和 Prisma。`SHUTDOWN_TIMEOUT_MS` 默认 15 秒。

## 常用命令

```bash
npm run dev       # 初始化数据库并启动热更新开发服务
npm run build     # 生成 Prisma Client 并编译 TypeScript
npm start         # 应用 migrations 后启动已编译服务
npm run db:setup  # 手动生成客户端并初始化数据库
npm run check     # 完整构建检查
```

`db:migrate` 为 macOS + SQLite 的 Prisma schema-engine 兼容性设置了 `RUST_LOG=info`；这不会改变 migration 内容，只是避免 CLI 在该环境下返回空的 `Schema engine error`。

## Docker

```bash
docker build -t soothsayer-backend .
docker run --rm -p 3001:3001 --env-file .env -v soothsayer-data:/data soothsayer-backend
```

生产环境必须设置安全的 `JWT_SECRET`，并通过 `CORS_ORIGINS` 配置允许访问的前端地址；多个地址使用逗号分隔。

本地双服务与 Redis 编排文件位于工作区根目录的 `docker-compose.local.yml`。该文件使用 Mock 模型，仅用于本地联调，不能作为生产密钥配置。

工作区根目录的 `docker-compose.production.yml` 和 `deploy/production/` 提供单 Backend、单 Agent 和 Redis 的通用生产模板。生产镜像使用非 root 用户和 `/api/ready` 容器健康检查。
