# syntax=docker/dockerfile:1
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:web
# Bake in the NASR cycle current at build time so a fresh machine boots without reaching the FAA.
RUN DATA_DIR=/app/seed-nav npm run navdata:build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data NAV_SEED_DIR=/app/seed-nav WEB_DIR=/app/dist/web PORT=8080
COPY package.json package-lock.json ./
# tsx runs the TypeScript server directly, so dev dependencies stay installed.
RUN npm ci
COPY shared ./shared
COPY navdata ./navdata
COPY server ./server
COPY --from=build /app/dist/web ./dist/web
COPY --from=build /app/seed-nav ./seed-nav
EXPOSE 8080
CMD ["npx", "tsx", "server/index.ts"]
