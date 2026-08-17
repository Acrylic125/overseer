const CF_ICON_BY_KIND: Record<string, string> = {
  Worker: "cf-worker",
  "Durable Object": "cf-do",
  Workflow: "cf-workflow",
  KV: "cf-worker-kv",
  D1: "cf-d1",
  R2: "cf-r2",
  Vectorize: "cf-vectorize",
  Queue: "cf-queue",
};

export function iconForKind(kind: string) {
  return CF_ICON_BY_KIND[kind] ?? "all-unknown";
}
