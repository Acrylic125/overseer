const response = await fetch("http://127.0.0.1:3000/api/trpc/infrastructure.list", {
  signal: AbortSignal.timeout(25_000),
});
if (!response.ok) throw new Error(`Infrastructure API returned ${response.status}`);
const body = await response.json();
if (body.result?.data?.services?.length !== 24) {
  throw new Error("Expected 24 seeded infrastructure services.");
}
