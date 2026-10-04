FROM node:24-slim

WORKDIR /app

# deps primeiro (cache)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages ./packages
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# código da API + deps dev mínimas para correr tsx
COPY apps/api ./apps/api
RUN npm --workspace apps/api install --omit=dev 2>/dev/null || true
RUN npm i -g tsx 2>/dev/null || npm install -g tsx

ENV NODE_ENV=production
ENV PORT=3001
# No Render Free não há disco persistente — fica efémero (/tmp).
# Numa VM/Fly com volume, define SQLITE_PATH=/data/data.db
ENV SQLITE_PATH=/tmp/data.db

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["sh", "-c", "node --import tsx/esm apps/api/src/main.ts"]
