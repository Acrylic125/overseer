FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

RUN npm install --global pnpm@10.26.0
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY ui/package.json ui/package.json
COPY cli/package.json cli/package.json
COPY packages/overseer-sdk/package.json packages/overseer-sdk/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY --chown=node:node . .
RUN pnpm --dir packages/overseer-sdk build \
    && mkdir -p /data /workspace/ui/.next \
    && chown -R node:node /data /workspace/ui/.next /workspace/packages/overseer-sdk/dist

USER node
EXPOSE 3000
CMD ["sh", "-c", "node dev/local-test/seed.mjs && exec pnpm --dir ui dev --hostname 0.0.0.0 --port 3000"]
