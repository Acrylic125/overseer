import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { layout } from "../../packages/overseer-sdk/dist/index.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const output = process.env.INFRASTRUCTURE_DB_PATH;
if (!output) throw new Error("Set INFRASTRUCTURE_DB_PATH to this instance's seed destination.");

try {
  await readFile(output);
  console.log(`Using existing instance data at ${output}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;

  const groups = ["Production/Commerce/API", "Production/Commerce/Data", "Production/Identity", "Staging/Commerce"];
  const kinds = ["cf-worker", "cf-d1", "r2", "vercel", "azure-entra", "cf-worker-kv"];
  const resources = groups.flatMap((group, groupIndex) =>
    kinds.map((asset, kindIndex) => ({
      id: `local:${groupIndex}-${kindIndex}`,
      group,
      name: `${["Checkout API", "Orders database", "Product images", "Storefront", "Customer identity", "Session cache"][kindIndex]} ${groupIndex + 1}`,
      url: "",
      service: asset,
      asset,
      fields: {
        environment: group.startsWith("Production") ? "production" : "staging",
        region: "Singapore",
        owner: "Local test team",
        enabled: true,
      },
      alerts: kindIndex === 1 && groupIndex === 0
        ? [{ type: "warning", message: "Synthetic capacity warning for layout testing." }]
        : kindIndex === 4 && groupIndex === 2
          ? [{ type: "error", message: "Synthetic identity configuration error." }]
          : [],
      tags: { namespace: "local" },
    })),
  );
  const connections = groups.flatMap((_, index) => [
    { nodes: [`local:${index}-0`, `local:${index}-1`], labels: ["Queries orders", "Used by checkout"] },
    { nodes: [`local:${index}-0`, `local:${index}-2`], labels: ["Reads images", "Serves checkout"] },
    { nodes: [`local:${index}-3`, `local:${index}-0`], labels: ["Calls API", "Serves storefront"] },
    {
      nodes: [`local:${index}-0`, `local:${index}-4`],
      labels: ["Authenticates customers", "Trusts checkout"],
      ...(index === 2 ? { type: "error" } : {}),
    },
    { nodes: [`local:${index}-0`, `local:${index}-5`], labels: ["Caches sessions", "Stores sessions"] },
  ]);
  const packed = layout({
    resources,
    connections,
    glb: await readFile(path.join(projectRoot, "ui/public/assets.glb")),
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(packed, null, 2)}\n`, { flag: "wx" });
  console.log(`Seeded ${resources.length} synthetic services and ${connections.length} connections at ${output}`);
}
