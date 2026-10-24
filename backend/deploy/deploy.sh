#!/bin/bash
set -e

# 本脚本在 macOS 本地运行，把代码同步到服务器并重新部署。
# 用法：./deploy.sh
#
# 登录方式（二选一，均不提供默认密码）：
#   1. 推荐：配置 SSH key 免密登录（ssh-copy-id root@81.70.23.109）
#   2. 通过环境变量传入密码：SERVER_PASSWORD=xxx ./deploy.sh

SERVER="root@81.70.23.109"
REMOTE_DIR="/opt/echomere"

# 脚本位于 echomere-deploy/，项目根目录是其上级目录
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

SSH_OPTS=(-o StrictHostKeyChecking=no)

# 优先 SSH key 免密登录；设置了 SERVER_PASSWORD 时才使用 sshpass
ssh_run() {
  if [ -n "$SERVER_PASSWORD" ]; then
    if ! command -v sshpass >/dev/null 2>&1; then
      echo "未安装 sshpass：请先安装（brew install sshpass），或改用 SSH key 免密登录"
      exit 1
    fi
    sshpass -p "$SERVER_PASSWORD" ssh "${SSH_OPTS[@]}" "$SERVER" "$1"
  else
    ssh "${SSH_OPTS[@]}" "$SERVER" "$1"
  fi
}

rsync_run() {
  if [ -n "$SERVER_PASSWORD" ]; then
    sshpass -p "$SERVER_PASSWORD" rsync -avz -e "ssh ${SSH_OPTS[*]}" "$@"
  else
    rsync -avz -e "ssh ${SSH_OPTS[*]}" "$@"
  fi
}

echo "==> 同步代码到服务器..."
rsync_run \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=.next \
  "$PROJECT_ROOT/echomere-backend" \
  "$PROJECT_ROOT/echomere-front" \
  "$PROJECT_ROOT/echomere-deploy" \
  "$SERVER:$REMOTE_DIR/"

REMOTE_COMPOSE_DIR="$REMOTE_DIR/echomere-deploy"

echo "==> 停止旧的 metasight-clone 服务并释放 8080 端口..."
ssh_run "cd /opt/metasight-clone && docker compose down 2>/dev/null || true"

echo "==> 创建数据卷（如不存在）..."
ssh_run "docker volume inspect echomere-data >/dev/null 2>&1 || docker volume create echomere-data"

echo "==> 在服务器上构建并启动..."
ssh_run "cd $REMOTE_COMPOSE_DIR && docker compose down && docker compose build --no-cache && docker compose up -d"

echo "==> 检查服务状态..."
ssh_run "cd $REMOTE_COMPOSE_DIR && docker compose ps && docker compose logs --tail=30 backend frontend nginx"

echo "==> 部署完成，访问 http://81.70.23.109:8080"
