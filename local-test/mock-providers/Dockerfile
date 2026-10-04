FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV CERT_DIR=/certs
WORKDIR /app
COPY --chmod=755 entrypoint.sh ./
COPY fixtures.mjs server.mjs ./
RUN mkdir -p /certs && chown node:node /certs

USER node
EXPOSE 8080 8443
HEALTHCHECK --interval=3s --timeout=3s --retries=20 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["./entrypoint.sh"]
