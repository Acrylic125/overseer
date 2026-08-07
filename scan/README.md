# Overseer scan

TypeScript Node scrapers that pull provider resources, pack them into a
layout, and write a JSON "database" for the Next.js UI.

## Structure

- `ServiceScanner` (`src/scanner.ts`) — provider scan contract
- `scanners/cf-scanner.ts` — Cloudflare: (1) scan & transform, (2) group
- `layout-service.ts` — cluster pack → shelf pack → platforms / icons / connectors
- `connector-paths.ts` — orthogonal walk (ported from the UI path router)

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
