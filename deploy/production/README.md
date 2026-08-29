# Echomere 完整生产部署模板

该模板用于单 Front、单 Backend、单 Agent 和 Redis 的单机生产拓扑。Agent 没有宿主机端口，只能被 Compose 私有网络中的 Backend 访问。

## 1. 准备本地私密配置

```bash
cp deploy/production/.env.production.example deploy/production/.env.production
cp deploy/production/model-profiles.example.json deploy/production/model-profiles.json
```

填写 `.env.production`。不要把真实 Key 写入 `model-profiles.json`；该文件只通过 `apiKeyEnv` 引用部署平台的 Secret。默认 `AGENT_MAX_QUALITY_REWRITES=1`，表示首稿未通过质量检查时自动重写一次。上线前必须更换开发期曾经暴露的模型 Key。

## 2. 启动前检查

Agent 生产启动命令会先执行 `npm run production:check`。检查项包括强密钥、持久化绝对路径、Redis、Backend 工具数据源、模型档案、service 切换确认和禁用本地静态 Token。失败时容器直接退出，不会带错启动。

## 3. 启动

```bash
docker compose \
  --env-file deploy/production/.env.production \
  -f compose.production.yml \
  up --build -d
```

Front 和 Backend 默认分别绑定宿主机 `127.0.0.1:3101` 与 `127.0.0.1:3001`，应由同机 Nginx/Caddy 提供 HTTPS。云平台必须监听全网卡时，再显式修改对应的 bind address，同时使用平台入站规则限制端口。

## 4. 验收

```bash
ECHOMERE_SMOKE_BASE_URL=http://127.0.0.1:3001 \
ECHOMERE_SMOKE_FRONT_URL=http://127.0.0.1:3101 \
  node deploy/production/smoke-check.mjs
```

冒烟检查要求 Front 首页、Backend `/api/health` 和 `/api/ready` 同时成功。Docker 健康检查也使用 readiness，因此 Redis、Agent 或数据库故障时 Backend 不会被当作可接流量实例。

## 运行边界

- 当前 Agent 模型选择是单写实例设计，不要将 `agent` 扩容到多副本。
- SQLite 数据位于命名卷，需要配置宿主机卷快照或定时备份。
- Redis 不发布宿主机端口，Agent 也不发布宿主机端口。
- 正式域名、证书、备份保留期和云平台配置需在选定部署平台后补充。
