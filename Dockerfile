FROM node:24-bookworm-slim AS workspace

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/overseer-sdk/package.json packages/overseer-sdk/
COPY cli/package.json cli/
COPY ui/package.json ui/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm --filter @acrylic125/overseer-sdk build

FROM workspace AS cli
WORKDIR /app/cli
CMD ["pnpm", "exec", "tsx", "src/cli.ts", "scan", "--skip-assets", "--dir", "/data"]

FROM workspace AS ui
# Rebake so the GLB atlas includes every icon in cli/assets, not the committed snapshot.
RUN cd cli && pnpm exec tsx src/cli.ts assets --dir ../ui/public
WORKDIR /app/ui
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=5s --start-period=30s --retries=60 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["pnpm", "exec", "next", "dev", "--hostname", "0.0.0.0", "--port", "3000"]
