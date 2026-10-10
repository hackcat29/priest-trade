FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

FROM base AS builder
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/candle-engine/package.json apps/candle-engine/
COPY packages/offchain/package.json packages/offchain/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
RUN pnpm install --no-frozen-lockfile --filter @perpes/candle-engine...
COPY packages/offchain ./packages/offchain
COPY packages/types ./packages/types
COPY packages/config ./packages/config
COPY apps/candle-engine ./apps/candle-engine
WORKDIR /app
RUN pnpm --filter @perpes/candle-engine... build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/candle-engine/package.json ./apps/candle-engine/
COPY packages/offchain/package.json packages/offchain/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
RUN pnpm install --no-frozen-lockfile --prod --filter @perpes/candle-engine...

COPY --from=builder /app/packages/offchain ./packages/offchain
COPY --from=builder /app/packages/types ./packages/types
COPY --from=builder /app/packages/config ./packages/config

WORKDIR /app/apps/candle-engine
COPY --from=builder /app/apps/candle-engine/dist ./dist
COPY --from=builder /app/apps/candle-engine/package.json ./

CMD ["node", "dist/main.js"]
