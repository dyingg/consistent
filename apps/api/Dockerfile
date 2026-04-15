FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

FROM base AS pruner
WORKDIR /app
RUN npm i -g turbo@2.9.6
COPY . .
RUN turbo prune @consistent/api --docker

FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --prod=false

FROM base AS builder
WORKDIR /app
COPY --from=installer /app/ .
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo build --filter=@consistent/api

FROM base AS runner
WORKDIR /app
COPY --from=builder /app/ .
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
