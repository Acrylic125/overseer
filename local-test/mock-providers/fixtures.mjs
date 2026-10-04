const DAY_MS = 24 * 60 * 60 * 1000;

// Evaluated once at startup so repeated scans see identical data unless the admin API mutates it.
function daysFromNow(days) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

export const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
export const ZONE_ID = "fedcba9876543210fedcba9876543210";
export const D1_ID = "6f1c2a52-6d0f-4c55-9a0e-0d9b8a0f1d01";
export const KV_ID = "9a3b1d7e5c2f4a6b8d0e1f2a3b4c5d6e";

export const TENANT_ID = "11111111-1111-1111-1111-111111111111";
export const CLIENT_ID = "33333333-3333-3333-3333-333333333333";
export const CLIENT_SECRET = "local-test-azure-secret";
export const GRAPH_TOKEN = "local-test-graph-token";

export const cloudflare = {
  accounts: [{ id: ACCOUNT_ID, name: "Acme (local test)" }],
  zones: [{ id: ZONE_ID, name: "acme.test", status: "active" }],
  dnsRecords: [
    { id: "dns-shop", type: "CNAME", name: "shop.acme.test", content: "cname.vercel-dns.com", proxied: false },
    { id: "dns-docs", type: "CNAME", name: "docs.acme.test", content: "cname.vercel-dns.com", proxied: false },
    { id: "dns-api", type: "A", name: "api.acme.test", content: "192.0.2.10", proxied: true },
    { id: "dns-cdn", type: "CNAME", name: "cdn.acme.test", content: "public.r2.dev", proxied: true },
    { id: "dns-txt", type: "TXT", name: "acme.test", content: "v=spf1 -all", proxied: false },
  ],
  routes: [{ id: "route-api", pattern: "api.acme.test/*", script: "api-gateway" }],
  subdomain: "acme",
  workers: {
    "api-gateway": {
      modified_on: daysFromNow(-3),
      bindings: [
        { type: "plain_text", name: "ASSET_ORIGIN", text: "https://cdn.acme.test" },
        { type: "secret_text", name: "STRIPE_SECRET_KEY" },
        { type: "kv_namespace", name: "SESSIONS", namespace_id: KV_ID },
        { type: "d1", name: "DB", id: D1_ID },
        { type: "r2_bucket", name: "ASSETS", bucket_name: "assets" },
        { type: "queue", name: "ORDER_EVENTS", queue_name: "order-events" },
        { type: "durable_object_namespace", name: "RATE_LIMITER", class_name: "RateLimiter" },
        { type: "workflow", name: "CHECKOUT", workflow_name: "checkout" },
      ],
      secrets: {
        STRIPE_SECRET_KEY: { text: "sk_test_51LocalTestOnlyNotARealKey0000", modified_on: daysFromNow(-120) },
      },
    },
    "order-consumer": {
      modified_on: daysFromNow(-10),
      bindings: [{ type: "d1", name: "DB", id: D1_ID }],
      secrets: {},
    },
  },
  durableObjects: [
    { id: "do-rate-limiter", name: "api-gateway_RateLimiter", script: "api-gateway", class: "RateLimiter" },
  ],
  workflows: [
    {
      id: "wf-checkout",
      name: "checkout",
      script_name: "api-gateway",
      class_name: "CheckoutWorkflow",
      created_on: daysFromNow(-30),
      modified_on: daysFromNow(-3),
    },
  ],
  workflowVersions: {
    checkout: [{ id: "wfv-1", created_on: daysFromNow(-3), modified_on: daysFromNow(-3) }],
  },
  workflowGraph: {
    nodes: [
      { type: "step", name: "reserve-stock" },
      { type: "step", name: "charge-card" },
      { type: "sleep", name: "wait-for-fulfilment" },
      { type: "step", name: "send-receipt" },
    ],
  },
  kv: [{ id: KV_ID, title: "SESSIONS" }],
  d1: [{ uuid: D1_ID, name: "orders-db", created_at: daysFromNow(-60) }],
  r2: {
    assets: {
      creation_date: daysFromNow(-90),
      domains: [{ domain: "cdn.acme.test", enabled: true, status: { ownership: "active", ssl: "active" } }],
      // Only the storefront may read assets cross-origin; the API gateway origin is deliberately missing.
      cors: { rules: [{ allowed: { origins: ["https://shop.acme.test"], methods: ["GET", "HEAD"] } }] },
    },
  },
  vectorize: [{ name: "product-embeddings", created_on: daysFromNow(-20) }],
  queues: [
    {
      queue_id: "q-order-events",
      queue_name: "order-events",
      consumers: [{ type: "worker", script_name: "order-consumer" }],
      producers: [{ type: "worker", script: "api-gateway" }],
    },
  ],
};

export const azureApplications = [
  {
    id: "44444444-4444-4444-4444-444444444444",
    appId: "55555555-5555-5555-5555-555555555555",
    displayName: "storefront-auth",
    web: { redirectUris: ["https://shop.acme.test/api/auth/callback/microsoft-entra-id"] },
    spa: { redirectUris: [] },
    publicClient: { redirectUris: [] },
    passwordCredentials: [
      { displayName: "production", hint: "Xy7", startDateTime: daysFromNow(-200), endDateTime: daysFromNow(10) },
    ],
  },
  {
    id: "66666666-6666-6666-6666-666666666666",
    appId: "77777777-7777-7777-7777-777777777777",
    displayName: "ops-portal",
    web: { redirectUris: ["https://ops.acme.test/signin-oidc"] },
    spa: null,
    publicClient: null,
    passwordCredentials: [
      { displayName: "legacy", hint: "Qm2", startDateTime: daysFromNow(-400), endDateTime: daysFromNow(-5) },
      { displayName: "ci", hint: "Ab9", startDateTime: daysFromNow(-15), endDateTime: null },
    ],
  },
];
