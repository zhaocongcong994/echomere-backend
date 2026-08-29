FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --chown=node:node src ./src

RUN mkdir -p /data /run/echomere \
  && chown -R node:node /data /run/echomere

ENV NODE_ENV=production
ENV AGENT_HOST=0.0.0.0
ENV AGENT_PORT=4310
ENV AGENT_DB_PATH=/data/agent.db

EXPOSE 4310

HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4310/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

USER node

CMD ["npm", "run", "server:production"]
