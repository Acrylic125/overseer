# Overseer CLI

Unified CLI for provider setup, asset baking, and the infrastructure pipeline.

Providers: Cloudflare (`PROVIDER_CF_<ns>_API_KEY`), Vercel
(`PROVIDER_VERCEL_<ns>_API_KEY`, optional `PROVIDER_VERCEL_<ns>_TEAM_ID`) and
Azure (`PROVIDER_AZURE_<ns>_TENANT_ID` / `_CLIENT_ID` / `_CLIENT_SECRET`).

## Pipeline

`scan` runs three steps:

1. **Precompute** — bake icons, platform, and shapes into `assets.glb`
2. **Sync** — scrape only the scopes that are stale, into `cli/.overseer/cache/`
3. **Link** — resolve references across every cached scope and write `graph.json`

Layout is not part of the scan. The UI lays out `graph.json` per lens
(Apps / Traffic / Accounts) when it is viewed.

### Scopes and the cache

A scope is one scanner for one account: `cloudflare:prod/<accountId>/worker`.
Each scope is cached as its own file with a TTL (Workers 1h, everything else 6h).
A sync skips scopes that are still fresh, so changing one thing only re-scrapes
what you ask for:

```bash
pnpm cli sync cloudflare:prod/worker          # just Workers in one namespace
pnpm cli sync vercel --force                  # every Vercel scope, ignore TTL
pnpm cli graph                                # relink from cache, no network
```

Workers additionally skip their settings/secrets calls when `modified_on` is
unchanged since the last scrape.

Secret values are redacted at scrape time (`abc******xyz`, values under 12
characters are fully masked), so neither the cache nor `graph.json` contain them.

### Chains across services

Every resource declares what it **exposes** (hostnames, ids, names) and what it
**references** (env values, bindings, DNS targets, redirect URIs). Linking
produces directed, typed edges (`dns`, `route`, `binding`, `env`, `auth`).
Cloudflare DNS hostnames front the services behind them, so a chain reads:

```
Vercel project --env--> api.acme.com (DNS) --dns--> Worker --binding--> D1
```

## Output

All artifacts land flat in `./_generated` (cwd), or in `--dir <path>`:

```
_generated/
  assets.glb
  platform-gradient.png
  graph.json
```

`graph.json` is validated by `graphSnapshotSchema` from the SDK:
`resources`, `edges`, `changes` (added/modified since the previous scrape of
each scope), `removed`, `scopes`, `warnings`.

## Setup

```bash
pnpm install
```

## Commands

```bash
pnpm cli
pnpm env
pnpm scan [filters] [--force] [--skip-assets] [--dir <path>]
pnpm sync [filters] [--force] [--dir <path>]
pnpm graph [--dir <path>]
pnpm assets [--dir <path>]
pnpm mock [--dir <path>]
```

Copy into the UI when developing the Next app:

```bash
pnpm assets --dir ../ui/public
pnpm scan --skip-assets --dir ../ui/public   # or: pnpm mock --dir ../ui/public
```

## Using the SDK directly

```ts
import { fileCache, overseer } from "@acrylic125/overseer-sdk";
import { cloudflare } from "@acrylic125/overseer-sdk/cloudflare";
import { vercel } from "@acrylic125/overseer-sdk/vercel";

const o = overseer({
  cache: fileCache(".overseer/cache"),
  providers: [
    cloudflare({ namespace: "prod", apiToken }),
    vercel({ namespace: "web", apiToken: vercelToken }),
  ],
});

await o.sync({ only: ["cloudflare:prod/worker"] });
const graph = await o.graph();
graph.downstream("cf:prod:<account>:worker:api");
graph.path(fromId, toId);
```
