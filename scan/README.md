# Overseer scan

TypeScript Node scraper that pulls Cloudflare resources and writes a JSON
"database" for the Next.js UI.

## Setup

```bash
pnpm install
```

Copy API tokens into `scan/.env` or reuse `ui/.env`:

```
PROVIDER_CF_<Namespace>_API_KEY=...
```

## Run

```bash
pnpm scan
```

Writes `../ui/data/infrastructure.json` by default. Optional custom path:

```bash
pnpm scan ./out/my-db.json
```
