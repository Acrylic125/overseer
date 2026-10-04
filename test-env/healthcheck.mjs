import { checkDevClient } from "./check-dev-client.mjs";

const origin = "http://127.0.0.1:3000";
const response = await fetch(`${origin}/api/trpc/infrastructure.list`, { signal: AbortSignal.timeout(8000) });
if (!response.ok) throw new Error(`Infrastructure API returned ${response.status}`);
const body = await response.json();
if (!body.result?.data?.services?.length) throw new Error("Infrastructure API did not return any services");
const page = await fetch(origin, { signal: AbortSignal.timeout(15000) });
if (!page.ok || !(await page.text()).includes("Overseer")) throw new Error("Application page is not ready");
await checkDevClient(origin);
