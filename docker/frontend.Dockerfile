FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend frontend
COPY shared shared
RUN npm run build --workspace @nutri/frontend

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/frontend/package.json frontend/package.json
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/frontend frontend
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "serve:container", "--workspace", "@nutri/frontend"]
