# ---------- 构建阶段 ----------
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# better-sqlite3 通常有预编译包，这里装编译工具做兜底
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# 先只拷贝清单，最大化利用层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/dsh/package.json packages/dsh/
COPY packages/server/package.json packages/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm --filter @tiny-buddy/web build

# ---------- 运行阶段 ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web/dist ./apps/web/dist

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@tiny-buddy/server", "start"]
