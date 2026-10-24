# Echomere

**一念成漪，照见未见。** Echomere 是一个 AI 命理应用：以八字（BaZi）为底座，提供每日运势、AI 命理解读对话、多档案管理与订阅体系。

## TL;DR

**解决什么问题：** 想随时查看自己和家人的每日运势、与 AI 深入讨论命理，但市面上的工具要么只做静态排盘、要么缺少档案管理和连续的对话上下文。

**方案：** 前后端一体的全栈应用——后端负责排盘计算（lunar-javascript + taibu-core）、数据持久化和 LLM 对话；前端提供涟漪视觉风格的交互界面，`/api/*` 自动代理到本地后端，无需处理跨域。

| 功能 | 说明 |
|------|------|
| 八字排盘 | 基于出生信息的四柱计算与解读 |
| 每日运势 | 按日生成的 fortune 推送 |
| AI 对话 | 带上下文的命理问答（LLM_API_KEY 可选，未配置时返回占位回复） |
| 多档案 | 为家人/朋友建立多个命盘档案 |
| 订阅体系 | 会员订阅与账单记录 |

## 项目结构

```
echomere-backend/
├── backend/    # Express + Prisma (SQLite) API，端口 3001
└── frontend/   # vinext (Next.js + Vite) 前端，端口 3000，/api 代理到后端
```

`backend/` 和 `frontend/` 各自是独立的 npm 包和 Git 仓库，可以单独开发、构建、部署。

## 快速开始

```bash
# 1. 启动后端（首次会自动生成 Prisma Client 并应用 SQLite 迁移）
cd backend
npm install
cp .env.example .env   # 已有 .env 可跳过
npm run dev

# 2. 另开一个终端，启动前端
cd frontend
npm install
npm run dev

# 3. 验证
curl http://localhost:3001/api/health        # {"status":"ok"}
open http://localhost:3000
```

**环境要求：**

| 部分 | Node 版本 |
|------|-----------|
| backend | >= 20.9（推荐 22 LTS） |
| frontend | >= 22.13.0 |

## 常用命令

### backend/

```bash
npm run dev        # 初始化数据库并启动热更新开发服务
npm run build      # 生成 Prisma Client 并编译 TypeScript 到 dist/
npm start          # 应用迁移后启动已编译服务（生产）
npm run db:setup   # 手动生成客户端并初始化数据库
npm test           # 运行 src/lib 下的单元测试
npm run check      # 完整构建检查
```

### frontend/

```bash
npm run dev        # 启动开发服务器 (vinext dev)
npm run build      # 生产构建
npm start          # 运行生产构建产物
npm run lint       # ESLint 检查
```

## 环境变量

### backend/.env

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | SQLite 数据库路径（相对仓库根目录解析） | `file:./dev.db` |
| `PORT` | 服务端口 | `3001` |
| `CORS_ORIGINS` | 允许跨域的前端地址，逗号分隔 | `http://localhost:3000` |
| `JWT_SECRET` | 登录令牌签名密钥（生产必须设置为长随机串） | — |
| `LLM_API_KEY` | 可选；不配置时聊天接口返回占位回复 | 空 |
| `LLM_BASE_URL` | LLM API 地址 | `https://api.moonshot.cn/v1` |
| `LLM_MODEL` | 聊天模型 | `moonshot-v1-8k` |

### frontend 环境变量

开发模式下前端自动把 `/api/*` 代理到 `http://127.0.0.1:3001`，无需配置。需要指向其他后端时设置：

| 变量 | 说明 |
|------|------|
| `ECHOMERE_BACKEND_ORIGIN` | 后端源地址，如 `http://127.0.0.1:3001` |
| `ECHOMERE_BACKEND_HOST` | 转发时改写 Host 头（特殊部署场景使用） |

## API 概览

所有接口以 `/api` 为前缀，除登录/注册外均需 JWT。

| 路由 | 说明 |
|------|------|
| `POST /api/auth/*` | 注册、登录 |
| `GET/POST /api/profile` | 当前用户档案 |
| `GET/POST /api/profiles` | 多档案管理 |
| `POST /api/onboarding` | 新手引导流程 |
| `POST /api/bazi` | 八字排盘计算 |
| `GET/POST /api/conversations` | 对话会话管理 |
| `POST /api/chat` | AI 命理对话（流式/非流式） |
| `GET /api/daily-fortune` | 每日运势 |
| `GET /api/subscription` | 订阅状态 |
| `GET /api/health` | 健康检查（无需认证） |

## Docker（仅后端）

```bash
cd backend
docker build -t echomere-backend .
docker run --rm -p 3001:3001 --env-file .env -v echomere-data:/data echomere-backend
```

生产部署时必须设置强随机 `JWT_SECRET`，并通过 `CORS_ORIGINS` 配置前端地址。完整的多容器部署配置见 `backend/deploy/`。

## 故障排查

### 启动后端时提示 `Prisma Client could not be found`

**原因：** 依赖安装后没有生成客户端。

**修复：**

```bash
cd backend
npm run prisma:generate
```

### 前端页面正常，但所有 `/api` 请求 500/404

**原因：** 后端没有启动，或端口不是 3001。

**修复：** 确认后端日志中出现 `[backend] Server running on port 3001`，并用 `curl http://127.0.0.1:3001/api/health` 直接验证后端。

### 登录成功但后续请求返回 401

**原因：** `JWT_SECRET` 在两次启动之间发生了变化，旧令牌失效。

**修复：** 重新登录；生产环境请固定 `JWT_SECRET` 为长随机串，不要随重启更换。

### 聊天接口只返回占位回复

**原因：** 未配置 `LLM_API_KEY`（这是默认行为，其余功能不受影响）。

**修复：** 在 `backend/.env` 中填入 `LLM_API_KEY` 后重启服务。

## 已知限制

| 限制 | 说明 | 后续计划 |
|------|------|----------|
| LLM 为可选依赖 | 未配置 `LLM_API_KEY` 时无真实 AI 回复 | 接入更多模型提供商 |
| 数据库为 SQLite | 适合个人/中小规模，高并发写入受限 | 可切换 Prisma 支持的其他数据库 |
| 前端代理仅开发模式 | 生产环境需通过 nginx 等反向代理 `/api`（参考 `backend/deploy/nginx.conf`） | — |

## FAQ

**Q: 前后端可以分开部署吗？**

可以。两者独立构建：后端 `npm run build && npm start`（或 Docker），前端 `npm run build` 后托管静态产物，并把 `/api` 反向代理到后端。

**Q: `frontend/` 出现在 `git status` 里是一个未跟踪目录？**

`backend/` 与 `frontend/` 是两个独立的 Git 仓库（前端仓库嵌套在后端仓库内）。这是合并后的预期结构；如需合并为一个仓库，先移除 `frontend/.git` 再统一提交。

**Q: 数据库文件在哪？**

`backend/dev.db`（由 `DATABASE_URL=file:./dev.db` 指定，路径相对 `backend/` 解析）。删除该文件并重启即可重置数据（会重新应用全部迁移）。
