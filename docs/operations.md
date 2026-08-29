# Echomere Agent 运行手册

## 健康与就绪

- `/health` 只表示 Node 进程正在响应，不检查外部依赖。
- `/ready` 检查 Agent 运行数据库和并发存储。Redis 模式不可用时返回 503。
- `/metrics` 输出 Prometheus 文本；生产环境必须使用独立 `AGENT_METRICS_TOKEN`。
- `/api/runtime` 输出已脱敏的当前模型、输入/输出上限、思考模式、传输重试和质量重写策略；使用与其他 `/api/*` 相同的服务密钥保护。

流量入口只能依据 `/ready` 分配新请求。实例收到 `SIGTERM` 后会停止接收新连接，并在 `SHUTDOWN_TIMEOUT_MS` 内等待现有 SSE 运行结束。

生产容器通过 `npm run server:production` 启动，会先运行不访问外网的配置预检。Docker 健康检查使用 `/ready` 而非 `/health`，避免在 Redis 或 SQLite 不可用时继续接收新流量。

## Redis 并发租约

每次运行同时写入一个全局有序集合和一个经过 SHA-256 处理的用户有序集合。写入、清理过期项和并发判断在同一个 Lua 脚本中完成。

- 默认全局上限：8。
- 默认单用户上限：2。
- 默认租约 TTL：180 秒，每 60 秒续期。
- 实例异常退出后，租约无需人工清理，会在 TTL 后失效。
- Redis 获取失败时，新请求返回 `503 agent_concurrency_unavailable`。
- Redis 续租失败时，当前运行的 `AbortSignal` 会触发，运行进入中断状态。

## 首轮告警

工作区根目录的 `deploy/observability/prometheus-alerts.yml` 包含首轮规则：

- Backend 或 Agent 无法抓取。
- Backend 5xx 比例持续超过 5%。
- Agent 失败/中断比例持续超过 10%。
- Redis 并发存储出现不可用事件。
- Backend 用户限流或 Agent 并发拒绝异常增长。

告警阈值是内测起点，上线后应根据真实请求量和错误基线调整。

## 故障处理顺序

1. 检查 `/ready` 与 `/metrics` 是否可访问。
2. 使用 `X-Request-Id` 串联 Backend、Agent 和工具调用日志。
3. Redis 故障时先恢复 Redis，不要把生产实例临时切回 memory。
4. 模型供应商故障时保留 503/失败指标，不要自动切换到未经回归的模型。
5. 恢复后运行四模式回归，并确认失败、中断和并发不可用指标停止增长。

## 模型预算与重试

- 默认完整模型输入上限为 32,000 字符，超限时在调用 Provider 前以 `model_input_budget_exceeded` 结束。
- 默认最多重试 1 次，起始延迟 500ms，指数退避上限 4,000ms。
- 只有 Provider 明确标记为可重试、用户尚未收到任何内容、请求也未取消时才重试。
- Agent 会把首稿缓冲在服务端，通过输出泄漏和回答质量校验后才发送 `content_delta`。
- 默认允许 1 次质量重写，可用 `AGENT_MAX_QUALITY_REWRITES=0..2` 调整；质量重写不占用 Provider 传输重试预算。
- 每次草稿的质量检查和最终重写次数会存入 AgentRun 及 Backend 审计记录，Token usage 会按完整草稿累加。
- 重写预算用尽后仍未达标时，当次会完成但保留 `quality.passed=false`，同时增加 `echomere_agent_low_quality_completions_total`，便于告警和后续复盘。

## 模型配置档案

- `config/model-profiles.local.json` 默认被 Git 忽略，但文件中仍不应保存真实 Key。
- 每个档案通过 `apiKeyEnv` 引用 `.env.local` 中的密钥环境变量。
- `LLM_ACTIVE_PROFILE` 必须匹配已配置 id，且活动档案缺少 Key 时 Agent 拒绝启动，不会静默回退到 Mock。
- 默认修改 `LLM_ACTIVE_PROFILE` 后重启 Agent。本地开发可显式启用 `AGENT_RUNTIME_MODEL_SWITCH_ENABLED=true` 热切换。
- 热切换会先检查 Provider 模型列表，再持久化档案 id 并原子替换 Provider；密钥不进入状态文件或 API 响应。
- 运行中请求固定使用启动时的 Provider 快照，切换只影响后续请求。
- `local` 模式只允许 loopback 开发环境；生产使用 `service` 模式时会额外校验私网确认、强共享密钥、档案文件和持久化选择路径。
- 生产受控切换的配置、授权、审计与回滚流程见 [生产模型切换运行手册](./production-runtime-model-control.md)。
