#!/bin/bash
set -e

# 本脚本在 macOS 本地运行，把代码同步到服务器并重新部署。
# 用法：./deploy.sh

SERVER="root@81.70.23.109"
PASSWORD="${SERVER_PASSWORD:-12345Qwert!@}"
REMOTE_DIR="/opt/echomere"

# 脚本位于 echomere-deploy/，项目根目录是其上级目录
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 同步代码到服务器..."
if command -v sshpass >/dev/null 2>&1; then
  sshpass -p "$PASSWORD" rsync -avz \
    --exclude=.git \
    --exclude=node_modules \
    --exclude=dist \
    --exclude=.next \
    "$PROJECT_ROOT/echomere-backend" \
    "$PROJECT_ROOT/echomere-front" \
    "$PROJECT_ROOT/echomere-deploy" \
    "$SERVER:$REMOTE_DIR/"
else
  echo "请安装 sshpass 或手动同步代码"
  exit 1
fi

REMOTE_COMPOSE_DIR="$REMOTE_DIR/echomere-deploy"

echo "==> 停止旧的 metasight-clone 服务并释放 8080 端口..."
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no "$SERVER" "cd /opt/metasight-clone && docker compose down 2>/dev/null || true"

echo "==> 创建数据卷（如不存在）..."
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no "$SERVER" "docker volume inspect echomere-data >/dev/null 2>&1 || docker volume create echomere-data"

echo "==> 在服务器上构建并启动..."
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no "$SERVER" "cd $REMOTE_COMPOSE_DIR && docker compose down && docker compose build --no-cache && docker compose up -d"

echo "==> 检查服务状态..."
sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no "$SERVER" "cd $REMOTE_COMPOSE_DIR && docker compose ps && docker compose logs --tail=30 backend frontend nginx"

echo "==> 部署完成，访问 http://81.70.23.109:8080"
