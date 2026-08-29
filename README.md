# Echomere Full Platform

该分支是 Echomere 的完整集成快照，不用于替代或覆盖前端、后端各自的 `main`。

## 目录

- `apps/front/`：前端集成版本。
- `apps/backend/`：后端集成版本。
- `services/agent/`：Echomere Agent。
- `deploy/`：生产环境模板、监控规则和冒烟检查。
- `compose.local.yml`：本地四服务启动入口。
- `compose.production.yml`：单机生产部署入口。

## 当前源版本

- Front：`zhaocongcong994/echomere-front@26f7ec0`
- Backend：`zhaocongcong994/echomere-backend@ae9aff9`
- Agent：`30c5691`

前端和后端使用 Git subtree 导入，因此该分支包含完整源码，不依赖 Git Submodule。团队只需克隆本分支即可查看、测试和部署全部服务。

## 分支边界

- 不把本分支直接合并到后端 `main`。
- 前端、后端仍在各自仓库和主分支独立开发。
- 上游更新通过 `git subtree pull --squash` 同步到对应目录，再经过本分支的三端回归。
- `.env`、模型 Key、数据库和运行数据不得提交。

## 同步前端或后端更新

上游仓库的代码不会被本分支反向修改。在工作区干净时执行：

```bash
git fetch front main
git subtree pull --prefix=apps/front front main --squash

git fetch origin main
git subtree pull --prefix=apps/backend origin main --squash
```

每次同步后必须重新运行三端检查，通过后才能推送 `integration/full-platform`。

## 本地启动

```bash
docker compose -f compose.local.yml up --build
```

启动后默认地址：

- Front：`http://localhost:3101`
- Backend：`http://localhost:3001`
- Agent：`http://localhost:4310`

生产模板见 [deploy/production/README.md](./deploy/production/README.md)。
