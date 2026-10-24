FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/dev.db"
ENV PORT=3001

EXPOSE 3001

CMD ["npm", "start"]
