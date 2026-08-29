FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build
RUN mkdir -p /data && chown -R node:node /data

ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/backend.db"
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

USER node

CMD ["npm", "start"]
