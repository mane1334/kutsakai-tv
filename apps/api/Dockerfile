FROM node:24-slim

WORKDIR /app

# manifests primeiro (cache) — inclui TODOS os workspaces ou o npm ci falha
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json

RUN npm ci --omit=dev || npm install --omit=dev

# código necessário para a API correr (main.ts importa db, payments e 2 packages)
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY packages ./packages

RUN npm install -g tsx

ENV NODE_ENV=production
ENV PORT=3001
# No Render Free não há disco persistente — fica efémero (/tmp).
# Numa VM/Fly com volume, define SQLITE_PATH=/data/data.db
ENV SQLITE_PATH=/tmp/data.db

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["tsx", "apps/api/src/main.ts"]
