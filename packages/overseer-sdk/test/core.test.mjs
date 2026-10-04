import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { fileCache } from "../dist/core/cache.js";
import { overseer } from "../dist/core/overseer.js";
import { defineProvider } from "../dist/core/provider.js";
import { envReferences } from "../dist/core/claims.js";
import { linkEntries } from "../dist/core/link.js";
import { createGraph } from "../dist/core/graph.js";
import { redactSensitiveValue } from "../dist/core/utils.js";
import { collect } from "../dist/core/scrape-async.js";
import { layout } from "../dist/layout.js";

function entry(id, exposes = [], references = []) {
  return {
    resource: { id, name: id, group: "prod", url: "", service: "Worker", fields: {}, asset: "cf-worker", alerts: [], tags: { namespace: "prod" } },
    exposes, references,
  };
}

test("selective sync, TTL, force, versioning, diffs and offline reads", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "overseer-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let calls = 0;
  let fail = false;
  let entries = [entry("cf:one")];
  const worker = { key: "worker", version: 1, ttlMs: 3600000, async scan() {
    calls += 1;
    if (fail) throw new Error("upstream unavailable");
    return entries;
  } };
  const provider = defineProvider({ id: "cloudflare", namespace: "prod", scanners: [worker, { ...worker, key: "dns" }], async accounts() { return [{ account: "account", ctx: {} }]; } });
  const cache = fileCache(dir);
  const client = overseer({ providers: [provider], cache });
  assert.equal((await client.sync({ only: ["cloudflare:prod/worker"] })).scraped.length, 1);
  assert.equal(calls, 1);
  assert.equal((await client.sync({ only: ["cloudflare:prod/worker"] })).fresh.length, 1);
  assert.equal(calls, 1);
  entries = [entry("cf:two")];
  await client.sync({ only: ["cloudflare:prod/worker"], force: true });
  const snapshot = await client.snapshot();
  assert.equal(snapshot.changes["cf:two"], "added");
  assert.equal(snapshot.removed[0].id, "cf:one");
  assert.equal(snapshot.resources[0].tags.account, "account");
  fail = true;
  assert.equal((await client.sync({ only: ["cloudflare:prod/worker"], force: true })).failed.length, 1);
  assert.deepEqual((await client.snapshot()).resources, snapshot.resources);
  fail = false;
  worker.version += 1;
  assert.equal((await client.sync({ only: ["cloudflare:prod/worker"] })).scraped.length, 1);
  assert.equal((await overseer({ cache }).snapshot()).resources.length, 1);
  const stored = (await cache.list()).entries[0];
  stored.scrapedAt = "2000-01-01T00:00:00.000Z";
  await cache.write(stored);
  assert.equal((await client.sync({ only: ["cloudflare:prod/worker"] })).scraped.length, 1);
  await writeFile(path.join(dir, "broken.json"), "{broken");
  assert.deepEqual((await cache.list()).invalid, ["broken.json"]);
});

test("scope filenames cannot collide and writes reject invalid data", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "overseer-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cache = fileCache(dir);
  const data = { version: 1, provider: "cf", namespace: "prod", account: "a", scanner: "worker", scannerVersion: 1, scrapedAt: new Date().toISOString(), entries: [] };
  await cache.write({ ...data, scope: "cf:prod/a-b/worker" });
  await cache.write({ ...data, scope: "cf:prod/a/b-worker" });
  assert.equal((await cache.list()).entries.length, 2);
  await assert.rejects(cache.write({ ...data, scope: "bad", scrapedAt: "invalid" }));
});

test("directed cross-provider paths go through DNS and bindings stay in their account", () => {
  const entries = [
    entry("vercel:frontend", [], [{ type: "host", value: "https://api.acme.com/v1", kind: "env" }]),
    entry("cf:dns", [{ type: "host", value: "api.acme.com", label: "api.acme.com", entry: true }], [{ type: "host", value: "api.acme.com", kind: "dns" }]),
    entry("cf:worker", [{ type: "host", value: "api.acme.com", label: "api" }], [{ type: "ref", value: "database", kind: "binding" }]),
    entry("cf:db", [{ type: "ref", value: "database", label: "db" }]),
    entry("cf:other-db", [{ type: "ref", value: "database", label: "other" }]),
    entry("cf:parent", [{ type: "host", value: "acme.com", label: "parent" }]),
  ];
  entries[2].resource.tags.account = entries[3].resource.tags.account = "a";
  entries[4].resource.tags.account = "b";
  const edges = linkEntries(entries);
  assert.deepEqual(edges.map(({ from, to }) => [from, to]), [["vercel:frontend", "cf:dns"], ["cf:dns", "cf:worker"], ["cf:worker", "cf:db"]]);
  const graph = createGraph({ resources: entries.map((e) => e.resource), edges });
  assert.deepEqual(graph.path("vercel:frontend", "cf:db").map((r) => r.id), ["vercel:frontend", "cf:dns", "cf:worker", "cf:db"]);
  assert.equal(graph.path("cf:db", "vercel:frontend"), null);
  assert.equal(graph.path("missing", "missing"), null);
});

test("redaction keeps only hints and never serializes token-shaped references", () => {
  assert.equal(redactSensitiveValue("abcdefghijklmnop"), "abc******nop");
  assert.equal(redactSensitiveValue("short"), "******");
  assert.deepEqual(envReferences([{ value: "eyJhbGci.payload.signature", secret: true }]), []);
  assert.deepEqual(envReferences([{ value: "https://user:password@api.acme.com/path?token=secret", secret: true }]), [{ type: "host", value: "api.acme.com", kind: "env" }]);
});

test("pagination collects beyond 250 resources", async () => {
  async function* pages() { for (let i = 0; i < 300; i += 1) yield i; }
  assert.equal((await collect(pages())).length, 300);
});

test("layout preserves surviving positions when adding and removing resources", () => {
  const glb = Buffer.alloc(24, " ");
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(24, 8);
  glb.writeUInt32LE(4, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  glb.write("{}", 20);
  const resources = [entry("cf:a").resource, entry("cf:b").resource];
  const first = layout({ resources, edges: [], glb });
  const second = layout({ resources: [...resources, entry("cf:c").resource], edges: [], glb, previous: first });
  const positions = (output) => new Map(output.layout.flatMap((item) => item.type === "resource" ? [[item.ref, item.pos]] : []));
  for (const [id, pos] of positions(first)) assert.deepEqual(positions(second).get(id), pos);
  const third = layout({ resources: [resources[1]], edges: [], glb, previous: second });
  assert.deepEqual(positions(third).get("cf:b"), positions(first).get("cf:b"));
});

test("sparse long-distance connectors finish without scanning empty grid cells", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { createConnectorEngine, iconAabb } from ${JSON.stringify(new URL("../dist/connectors.js", import.meta.url).href)};
    import { DEFAULT_LAYOUT_CONFIG } from ${JSON.stringify(new URL("../dist/layout.js", import.meta.url).href)};
    const paths = createConnectorEngine(DEFAULT_LAYOUT_CONFIG.connectors).buildAllConnectorPaths(
      [iconAabb('a', 0, 0, 1, 1), iconAabb('b', 10000, 0, 1, 1)], [{ id: 'a', connections: ['b'] }]);
    if (paths.length !== 1 || paths[0].points.length < 2) process.exit(1);
  `], { timeout: 2000, encoding: "utf8" });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});
