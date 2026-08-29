# Echomere Backend × Agent 接入契约

本文档基于 `zhaocongcong994/echomere-backend` 的 `main` 分支代码建立，用于在不修改远程仓库的前提下完成本地 Agent Adapter。

## 建议调用拓扑

```text
前端
  └── Bearer JWT ──> Echomere Backend /api/chat/stream
                           └── 私网请求 ──> Agent /api/agent/stream
                                                  ├── GET Backend /api/profile
                                                  ├── GET Backend /api/profiles/:id
                                                  └── POST Backend /api/agent/tools/hexagram
```

- Backend 继续负责用户登录、JWT、Profile 所有权和 Prisma 数据。
- Agent 负责模式路由、多轮上下文、安全闸门、工具编排和模型调用。
- Backend 将当前用户的 Bearer Token 放在 Agent HTTP 请求头，不放入 JSON body。
- Agent 只在本次工具请求中使用 Token，不写入 AgentRun、ToolRun、Message 或日志。

## 现有后端可直接复用的契约

| 能力 | 现有端点 | 状态 | Agent 用途 |
|---|---|---|---|
| 主档案 + 八字盘 | `GET /api/profile` | 已支持 | 看运模式默认档案 |
| 指定档案 + 八字盘 | `GET /api/profiles/:id` | 已支持 | 用户指定 `profileId` |
| 对话读取 | `GET /api/conversations/:id` | 已支持 | Backend Prisma 保存产品对话与消息 |
| 聊天流 | `POST /api/chat/stream` | 本地副本已改造 | 代理 Agent SSE，保留前端兼容事件并幂等写库 |
| 六爻工具 | `POST /api/agent/tools/hexagram` | 本地副本已实现 | 问事模式一对话一卦，返回稳定 evidence ref |

Backend 返回的八字 `schemaVersion` 当前为 `2`，引擎为 `taibu-core 3.5.0`。Adapter 会校验结构版本、引擎、四柱、日主、`canonicalText` 和大运结构；不符合契约时会返回 `backend_invalid_response`，不会让模型猜测缺失字段。

## 六爻工具端点

新 Agent 不使用 `/api/chat/stream` 反向获取卦象。本地 Backend 副本已增加只返回工具事实的端点：

```http
POST /api/agent/tools/hexagram
Authorization: Bearer <user-jwt>
Content-Type: application/json
```

请求：

```json
{
  "conversationId": "conversation-id",
  "question": "我该不该接受这份工作？",
  "at": "2026-08-27T00:00:00.000Z"
}
```

响应：

```json
{
  "reused": false,
  "evidenceRef": "backend:hexagram:<conversationId>:<stable-id>",
  "hexagram": {
    "schemaVersion": 2,
    "engine": {
      "name": "taibu-core",
      "version": "3.5.0",
      "schemaVersion": 2
    },
    "originalName": "乾为天",
    "changedName": "坤为地",
    "changingYaos": [1, 6],
    "canonicalText": "……"
  }
}
```

后端会验证 `conversationId` 属于 JWT 中的 `userId`、对话模式为 `wenshi`，并保证同一对话只生成一个卦象。如已有卦象，返回原结果并设置 `reused: true`。

当前 Backend Adapter 在该端点返回 `404` 时会明确产生 `backend_contract_missing`，不会静默回退到 Mock 卦象。

## 对话持久化决策

当前本地集成中，Backend Prisma 是产品用户、Conversation、Message、Hexagram 和 BillingRecord 的唯一事实源。真实后端模式下，Agent 会用透传的 JWT 读取 Backend 正式历史，并使用 `clientRequestId` 排除 Backend 已预写的当前用户消息，避免同一句话重复进入 Prompt。

Agent SQLite 保留 AgentRun、ToolRun、对话模式元数据和上下文快照；在真实后端模式下不再写入产品用户/助手消息。Mock/独立模式仍可使用本地消息以便离线开发。

当前持久化边界：

1. Backend Prisma 是 Conversation/Message 的唯一事实源。
2. AgentRun/ToolRun 作为可审计执行记录，可继续独立存储或新增到 Prisma。
3. Agent 已从 Backend 读取正式历史，本地 Conversation 只保留模式元数据和快照。
4. 继续仅由 Backend 创建产品用户消息、助手消息和计费记录。

## 本地配置

```dotenv
AGENT_TOOLS_PROVIDER=echomere-backend
ECHOMERE_BACKEND_URL=http://127.0.0.1:3001
ECHOMERE_BACKEND_TIMEOUT_MS=10000
AGENT_SHARED_SECRET=与后端完全相同的服务间密钥
```

HTTP 调用时在 Agent 请求头中携带后端 JWT：

```bash
curl -N http://127.0.0.1:4310/api/agent/stream \
  -H "Authorization: Bearer $BACKEND_USER_TOKEN" \
  -H "X-Agent-Secret: $AGENT_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "backend-user-id",
    "clientRequestId": "request-001",
    "mode": "kanyun",
    "message": "2027 年事业怎么样？"
  }'
```

`ECHOMERE_BACKEND_TOKEN` 只用于本地 CLI 或单用户联调，不用于多用户生产环境。

## 2026-08-27 本地验证记录

- Backend 完整构建和默认测试通过，包含 Express/Prisma Agent 代理、readiness、请求追踪、环境校验、热切换代理和可切换限流。
- Agent 类型检查和默认测试通过；真实 Redis 双 Agent HTTP 集成测试另行启用。覆盖服务间密钥、readiness、分布式并发租约、环境校验、请求级 Provider 快照、指标鉴权和四模式回归。
- 使用两个真实本地 HTTP 服务完成 Backend → Agent → Backend 工具回调。看运返回 Profile 和流年 evidence，问事返回 Hexagram evidence。
- 同一问事对话连续请求后卦象被复用，第二轮 Agent 从 Backend 加载了前一轮的 2 条正式消息，Agent 本地产品消息数为 0。
- 相同 `clientRequestId` 并发请求已验证：用户消息、助手消息、对话计数和计费在同一 Prisma 事务中幂等收敛。
- 全新 SQLite 临时库已按顺序应用 5 份 Prisma migration。macOS + SQLite 下根据 Prisma 已知问题为 migration 命令设置 `RUST_LOG=info`。
- 双服务 `/ready` 均返回 200；同一 `X-Request-Id` 已验证出现在 Backend 响应、SSE `meta`、Agent 响应和后端工具请求中。
- 两个独立 Backend 限流实例连接真实本地 Redis，已验证共享原子计数：前两次放行、第三次拒绝。最终双服务回归的 readiness 同时返回 database/agent/rateLimit 为 `ok`。
- 两个独立 Agent HTTP 实例连接同一 Redis，已验证全局/单用户上限、主动释放、定时续租和实例崩溃后的 TTL 回收；实例 A 占用名额时，实例 B 对同一用户返回 429。
- 最终分布式回归使用同一个 Redis 同时承载 Backend 限流和 Agent 并发租约，Backend → Agent → Backend 问事工具回调、SSE、追踪和运行指标全部通过。
- Backend 与 Agent `/metrics` 均已验证未授权返回 401、携带独立监控 Token 返回 200；Agent 完成运行指标正确累加。
- 两个服务直接接收 `SIGINT` 时均输出 started/completed 停机事件并以 0 退出，临时 Redis 也正常关闭。
- `npm audit` 报告的 3 个 high 均来自 Prisma 开发工具链中的 `deepmerge-ts`；建议修复是把 Prisma 7 降为 6.12，存在版本回退风险，因此本阶段未运行 `audit fix --force`。新增 Redis 客户端不在该漏洞链路中。
