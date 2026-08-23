FROM node:22-bookworm-slim

WORKDIR /app

# 单独拷贝后端依赖并安装，利用缓存
COPY backend/package*.json ./
RUN npm ci

# 拷贝根目录的 Prisma schema 与后端源码
COPY prisma ../prisma
COPY backend .
COPY lib ../lib

# 将 schema 复制到 backend 内部，并修改 generator output 为后端自己的目录
RUN mkdir -p prisma && cp ../prisma/schema.prisma prisma/schema.prisma && \
    sed -i 's|output\s*=\s*"../lib/generated/prisma"|output = "../src/generated/prisma"|' prisma/schema.prisma && \
    npx prisma generate --schema=prisma/schema.prisma

ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/dev.db"
ENV PORT=3001

EXPOSE 3001

CMD ["npx", "tsx", "src/index.ts"]
