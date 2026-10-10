# syntax=docker/dockerfile:1
# WebFly: one image with the API server, the built web app and a baked-in NASR cycle (spec §12).

FROM node:22.22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Bake the NASR cycle in force at build time, so a fresh machine boots without reaching the FAA.
RUN npm run build:web \
 && npm run navdata:build -- --drop-cache \
 && npm prune --omit=dev

FROM node:22.22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/navdata ./navdata
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/data/ ./data/
EXPOSE 8080
# Node 22.18+ runs the TypeScript sources directly (type stripping); no compile step.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/main.ts"]
