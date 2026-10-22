# ============================================================================
# DOCKERFILE MULTI-STAGE — LK FINANÇAS (Cloud / Render / Railway / Fly.io / VPS)
# Usa Node 24 LTS com módulo SQLite nativo (node:sqlite) sem dependências C++
# ============================================================================

# Stage 1: Build do Frontend PWA (React + TypeScript + Tailwind)
FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build do Backend Zero-Knowledge (Node.js + TypeScript)
FROM node:24-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install
COPY backend/ ./
RUN npm run build

# Stage 3: Container de Produção enxuto e seguro
FROM node:24-alpine AS production
WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/app/data

COPY backend/package.json ./
RUN npm install --omit=dev

COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

VOLUME ["/app/data"]
EXPOSE 4000

CMD ["node", "dist/server.js"]
