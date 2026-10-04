FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

RUN npm install --global pnpm@10.26.0
WORKDIR /workspace
RUN chown node:node /workspace

# Cache dependency installation independently of application edits.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node ui/package.json ./ui/package.json
COPY --chown=node:node cli/package.json ./cli/package.json
COPY --chown=node:node packages/overseer-sdk/package.json ./packages/overseer-sdk/package.json
USER node
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY --chown=node:node . .
RUN pnpm --dir packages/overseer-sdk build
USER root
RUN mkdir -p /data /workspace/ui/.next && chown node:node /data /workspace/ui/.next
USER node

ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["sh", "-c", "node test-env/seed.mjs && exec pnpm --dir ui dev --hostname 0.0.0.0 --port 3000"]
