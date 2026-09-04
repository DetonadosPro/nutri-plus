FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

COPY backend backend
COPY shared shared

ENV NODE_ENV=production
EXPOSE 3001
CMD ["npx", "tsx", "backend/index.ts"]
