FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json ./
RUN corepack pnpm@10.26.0 install --prod
COPY server.mjs ./

USER node
EXPOSE 4000
HEALTHCHECK --interval=3s --timeout=3s --retries=20 CMD test -f /tmp/ready
CMD ["node", "server.mjs"]
