# Bygger klienten och kör servern i en och samma container.
FROM node:22-slim AS base
WORKDIR /app
RUN npm install -g pnpm@12.14.0 && npm cache clean --force

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM base
ENV NODE_ENV=production PORT=8080
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod && pnpm store prune
COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY server ./server
EXPOSE 8080
USER node
CMD ["node", "--import", "tsx", "server/index.ts"]
