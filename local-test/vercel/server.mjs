import { rmSync, writeFileSync } from "node:fs";
import http from "node:http";

import { createEmulator } from "emulate";

const PORT = 4000;
const EMULATOR_PORT = 4001;
const EMULATOR_URL = `http://127.0.0.1:${EMULATOR_PORT}`;
const TOKEN = "local-test-vercel-token";
const READY_FILE = "/tmp/ready";

// State is in memory, so a restarted container must not report ready until it reseeds.
rmSync(READY_FILE, { force: true });

const projects = [
  {
    name: "storefront",
    framework: "nextjs",
    domains: ["shop.acme.test"],
    envVars: [
      { key: "NEXT_PUBLIC_API_URL", value: "https://api.acme.test", type: "plain" },
      { key: "NEXT_PUBLIC_CDN_URL", value: "https://cdn.acme.test", type: "plain" },
      { key: "AUTH_SECRET", value: "local-test-auth-secret-0123456789", type: "encrypted" },
    ],
  },
  {
    name: "docs",
    framework: "nextjs",
    domains: ["docs.acme.test"],
    envVars: [],
  },
];

await createEmulator({
  service: "vercel",
  port: EMULATOR_PORT,
  hostname: "127.0.0.1",
  seed: {
    // Seeded projects belong to the emulator's built-in first user, "admin".
    tokens: { [TOKEN]: { login: "admin", scopes: [] } },
    vercel: {
      projects: projects.map(({ name, framework, envVars }) => ({ name, framework, envVars })),
    },
  },
});

// The seed format has no domains, so they are added through the API like a real user would.
for (const project of projects) {
  for (const domain of project.domains) {
    const response = await fetch(`${EMULATOR_URL}/v10/projects/${project.name}/domains`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ name: domain }),
    });
    if (!response.ok) {
      throw new Error(`Adding ${domain} to ${project.name} failed: ${response.status} ${await response.text()}`);
    }
  }
}

// emulate 0.12.1 omits project fields that @vercel/sdk requires when validating
// GET /v10/projects, so the proxy fills them with empty values.
const PROJECT_DEFAULTS = {
  alias: [],
  deploymentExpiration: {},
  resourceConfig: { functionDefaultRegions: [] },
  defaultResourceConfig: { functionDefaultRegions: [] },
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", EMULATOR_URL);
    const headers = { ...req.headers };
    delete headers.host;
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const upstream = await fetch(url, { method: req.method, headers, body });
    let payload = Buffer.from(await upstream.arrayBuffer());

    if (req.method === "GET" && url.pathname === "/v10/projects" && upstream.ok) {
      const parsed = JSON.parse(payload.toString());
      parsed.projects = parsed.projects.map((project) => ({ ...PROJECT_DEFAULTS, ...project }));
      payload = Buffer.from(JSON.stringify(parsed));
    }

    res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
    res.end(payload);
  })
  .listen(PORT, "0.0.0.0", () => {
    writeFileSync(READY_FILE, "");
    console.log(`Vercel emulator on :${PORT}`);
  });
