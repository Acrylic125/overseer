# Overseer CLI

Unified CLI for provider setup, asset baking, and the infrastructure pipeline.

Providers: Cloudflare (`PROVIDER_CF_<ns>_API_KEY`) and Vercel
(`PROVIDER_VERCEL_<ns>_API_KEY`, optional `PROVIDER_VERCEL_<ns>_TEAM_ID`).

## Pipeline

`scan` runs four steps end-to-end:

1. **Precompute** — bake icons, platform, and shapes into `assets.glb`
2. **Service scan** — each provider scanner scrapes and transforms its own resources, then `linkResources` matches claims to connection requirements.
3. **Layout** — pack platforms, icons, connectors
4. **Output** — write `infrastructure.json` (v2)

All artifacts land flat in `./_generated` (cwd), or in `--dir <path>`:

```
_generated/
  assets.glb
  platform-gradient.png
  infrastructure.json
```

## infrastructure.json v2

```ts
type Pos = [number, number, number]; // x, y, z
type Size = [number, number];        // width, depth — omit → [1, 1]

{
  version: 2,
  scannedAt: string,
  warnings: string[],
  services: [{ …identity, pos: Pos, size?: Size }],
  pads: [
    { type: "platform", id, group, parent?, pos, size? },
    { type: "shape", id, shape, group, parent?, label?, pos, size? },
  ],
  connectors: [{ from, to, path: Pos[] }],
}
```

Nest platforms with `parent` (pad id). Scene bake (bounds/camera/segments) is
derived in the UI at load time — not stored.

## Setup

```bash
pnpm install
```

## Commands

```bash
pnpm cli
pnpm env
pnpm scan
pnpm scan --skip-assets
pnpm scan --dir ./out
pnpm assets
pnpm assets --dir ../ui/public
pnpm mock
```

Copy into the UI when developing the Next app:

```bash
pnpm assets --dir ../ui/public
pnpm mock --dir ../ui/public
```

Verbose provider API logs:

```bash
OVERSEER_DEBUG=1 pnpm scan
```
