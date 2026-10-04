import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

import {
  ACCOUNT_ID,
  CLIENT_ID,
  CLIENT_SECRET,
  GRAPH_TOKEN,
  ZONE_ID,
  azureApplications,
  cloudflare,
} from "./fixtures.mjs";

const HTTP_PORT = 8080;
const HTTPS_PORT = 8443;
const CERT_DIR = process.env.CERT_DIR ?? "/certs";

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function envelope(result, extra = {}) {
  return { success: true, errors: [], messages: [], result, ...extra };
}

function cfError(res, status, code, message) {
  send(res, status, { success: false, errors: [{ code, message }], messages: [], result: null });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
  });
}

function pageList(url, items) {
  // V4 page-paginated SDK lists keep requesting until a page comes back empty.
  const page = Number(url.searchParams.get("page") ?? "1");
  const result = page > 1 ? [] : items;
  return envelope(result, {
    result_info: { page, per_page: 100, count: result.length, total_count: items.length },
  });
}

function workerList() {
  return Object.entries(cloudflare.workers).map(([id, worker]) => ({
    id,
    created_on: worker.modified_on,
    modified_on: worker.modified_on,
    handlers: ["fetch"],
  }));
}

const cloudflareRoutes = [
  ["GET", /^\/accounts$/, (url) => pageList(url, cloudflare.accounts)],
  ["GET", /^\/zones$/, (url) => pageList(url, cloudflare.zones)],
  ["GET", new RegExp(`^/zones/${ZONE_ID}/dns_records$`), (url) => pageList(url, cloudflare.dnsRecords)],
  ["GET", new RegExp(`^/zones/${ZONE_ID}/workers/routes$`), () => envelope(cloudflare.routes)],
  ["GET", /^\/accounts\/[^/]+\/workers\/scripts$/, () => envelope(workerList())],
  ["GET", /^\/accounts\/[^/]+\/workers\/workers$/, (url) => pageList(url, [])],
  [
    "GET",
    /^\/accounts\/[^/]+\/workers\/scripts\/([^/]+)\/settings$/,
    (_url, [name]) => {
      const worker = cloudflare.workers[name];
      if (!worker) return null;
      return envelope({ bindings: worker.bindings, compatibility_date: "2026-01-01" });
    },
  ],
  [
    "GET",
    /^\/accounts\/[^/]+\/workers\/scripts\/([^/]+)\/secrets$/,
    (_url, [name]) => {
      const worker = cloudflare.workers[name];
      if (!worker) return null;
      return envelope(Object.keys(worker.secrets).map((key) => ({ name: key, type: "secret_text" })));
    },
  ],
  [
    "GET",
    /^\/accounts\/[^/]+\/workers\/scripts\/([^/]+)\/secrets\/([^/]+)$/,
    (_url, [name, key]) => {
      const secret = cloudflare.workers[name]?.secrets[key];
      if (!secret) return null;
      return envelope({ name: key, type: "secret_text", ...secret });
    },
  ],
  ["GET", /^\/accounts\/[^/]+\/workers\/domains$/, () => envelope([])],
  ["GET", /^\/accounts\/[^/]+\/workers\/subdomain$/, () => envelope({ subdomain: cloudflare.subdomain })],
  [
    "GET",
    /^\/accounts\/[^/]+\/workers\/durable_objects\/namespaces$/,
    (url) => pageList(url, cloudflare.durableObjects),
  ],
  ["GET", /^\/accounts\/[^/]+\/workflows$/, (url) => pageList(url, cloudflare.workflows)],
  [
    "GET",
    /^\/accounts\/[^/]+\/workflows\/([^/]+)\/versions$/,
    (url, [name]) => pageList(url, cloudflare.workflowVersions[name] ?? []),
  ],
  [
    "GET",
    /^\/accounts\/[^/]+\/workflows\/[^/]+\/versions\/[^/]+\/graph$/,
    () => envelope(cloudflare.workflowGraph),
  ],
  ["GET", /^\/accounts\/[^/]+\/storage\/kv\/namespaces$/, (url) => pageList(url, cloudflare.kv)],
  ["GET", /^\/accounts\/[^/]+\/d1\/database$/, (url) => pageList(url, cloudflare.d1)],
  [
    "GET",
    /^\/accounts\/[^/]+\/r2\/buckets$/,
    () =>
      envelope({
        buckets: Object.entries(cloudflare.r2).map(([name, bucket]) => ({
          name,
          creation_date: bucket.creation_date,
        })),
      }),
  ],
  [
    "GET",
    /^\/accounts\/[^/]+\/r2\/buckets\/([^/]+)\/domains\/custom$/,
    (_url, [name]) => {
      const bucket = cloudflare.r2[name];
      if (!bucket) return null;
      return envelope({ domains: bucket.domains });
    },
  ],
  [
    "GET",
    /^\/accounts\/[^/]+\/r2\/buckets\/([^/]+)\/cors$/,
    (_url, [name]) => {
      const bucket = cloudflare.r2[name];
      if (!bucket) return null;
      return envelope(bucket.cors);
    },
  ],
  ["GET", /^\/accounts\/[^/]+\/vectorize\/v2\/indexes$/, () => envelope(cloudflare.vectorize)],
  ["GET", /^\/accounts\/[^/]+\/queues$/, () => envelope(cloudflare.queues)],
];

function handleCloudflare(req, res, url) {
  if (!req.headers.authorization?.startsWith("Bearer ") || req.headers.authorization.length <= 7) {
    cfError(res, 403, 10000, "Authentication error");
    return;
  }
  const path = url.pathname.slice("/client/v4".length);
  const accountMatch = /^\/accounts\/([^/]+)\//.exec(path);
  if (accountMatch && accountMatch[1] !== ACCOUNT_ID) {
    cfError(res, 403, 9109, "Unauthorized to access requested resource");
    return;
  }
  for (const [method, pattern, handler] of cloudflareRoutes) {
    if (req.method !== method) continue;
    const match = pattern.exec(path);
    if (!match) continue;
    const body = handler(url, match.slice(1).map(decodeURIComponent));
    if (body === null) {
      cfError(res, 404, 10007, "Not found");
      return;
    }
    send(res, 200, body);
    return;
  }
  console.warn(`[cloudflare] unhandled ${req.method} ${path}`);
  cfError(res, 404, 7003, `No route for ${req.method} ${path}`);
}

function handleAdmin(req, res, url) {
  const touch = /^\/__mock\/cloudflare\/workers\/([^/]+)\/touch$/.exec(url.pathname);
  if (req.method === "POST" && touch) {
    const worker = cloudflare.workers[touch[1]];
    if (!worker) {
      send(res, 404, { error: "unknown worker" });
      return;
    }
    worker.modified_on = new Date().toISOString();
    send(res, 200, { name: touch[1], modified_on: worker.modified_on });
    return;
  }
  send(res, 404, { error: "unknown admin route" });
}

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://mock-providers");
  if (url.pathname === "/health") {
    send(res, 200, { status: "ok" });
    return;
  }
  if (url.pathname.startsWith("/client/v4/")) {
    handleCloudflare(req, res, url);
    return;
  }
  if (url.pathname.startsWith("/__mock/")) {
    handleAdmin(req, res, url);
    return;
  }
  send(res, 404, { error: "not found" });
});

function openIdConfiguration(origin, tenant) {
  const base = `${origin}/${tenant}`;
  return {
    issuer: `${base}/v2.0`,
    authorization_endpoint: `${base}/oauth2/v2.0/authorize`,
    token_endpoint: `${base}/oauth2/v2.0/token`,
    end_session_endpoint: `${base}/oauth2/v2.0/logout`,
    jwks_uri: `${base}/discovery/v2.0/keys`,
    response_types_supported: ["code", "id_token", "code id_token", "token id_token", "token"],
    subject_types_supported: ["pairwise"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email", "offline_access"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    tenant_region_scope: "NA",
  };
}

const azureServer = https.createServer(
  {
    key: readFileSync(`${CERT_DIR}/key.pem`),
    cert: readFileSync(`${CERT_DIR}/cert.pem`),
  },
  async (req, res) => {
    const url = new URL(req.url ?? "/", `https://${req.headers.host}`);
    const origin = `https://${req.headers.host}`;

    const discovery = /^\/([^/]+)\/v2\.0\/\.well-known\/openid-configuration$/.exec(url.pathname);
    if (req.method === "GET" && discovery) {
      send(res, 200, openIdConfiguration(origin, discovery[1]));
      return;
    }

    if (req.method === "GET" && /^\/[^/]+\/discovery\/v2\.0\/keys$/.test(url.pathname)) {
      send(res, 200, { keys: [] });
      return;
    }

    if (req.method === "POST" && /^\/[^/]+\/oauth2\/v2\.0\/token$/.test(url.pathname)) {
      const form = new URLSearchParams(await readBody(req));
      if (form.get("grant_type") !== "client_credentials") {
        send(res, 400, { error: "unsupported_grant_type" });
        return;
      }
      if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) {
        send(res, 401, { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." });
        return;
      }
      send(res, 200, {
        token_type: "Bearer",
        expires_in: 3599,
        ext_expires_in: 3599,
        access_token: GRAPH_TOKEN,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1.0/applications") {
      if (req.headers.authorization !== `Bearer ${GRAPH_TOKEN}`) {
        send(res, 401, { error: { code: "InvalidAuthenticationToken", message: "Access token is empty." } });
        return;
      }
      send(res, 200, {
        "@odata.context": "https://graph.microsoft.com/v1.0/$metadata#applications",
        value: azureApplications,
      });
      return;
    }

    console.warn(`[azure] unhandled ${req.method} ${url.pathname}`);
    send(res, 404, { error: { code: "ResourceNotFound", message: `No route for ${url.pathname}` } });
  },
);

httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`Cloudflare mock on :${HTTP_PORT}/client/v4`);
});
azureServer.listen(HTTPS_PORT, "0.0.0.0", () => {
  console.log(`Entra + Graph mock on :${HTTPS_PORT}`);
});
