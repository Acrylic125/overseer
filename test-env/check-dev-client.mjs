import { randomBytes } from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";

// Page/API requests can pass while Next blocks the browser's dev client.
// Send the browser's Origin header and require a successful HMR handshake.
export function checkDevClient(origin) {
  return new Promise((resolve, reject) => {
    const request = http.request(new URL("/_next/webpack-hmr", origin), {
      headers: {
        Origin: new URL(origin).origin,
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
      },
    });
    request.setTimeout(8000, () => request.destroy(new Error("Dev client handshake timed out")));
    request.on("upgrade", (response, socket) => {
      socket.destroy();
      if (response.statusCode !== 101) reject(new Error(`Dev client returned ${response.statusCode}`));
      else resolve();
    });
    request.on("response", (response) => {
      response.resume();
      reject(new Error(`Dev client returned ${response.statusCode} for origin ${origin}`));
    });
    request.on("error", reject);
    request.end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.argv[2];
  if (!origin) throw new Error("Usage: node test-env/check-dev-client.mjs http://127.0.0.1:HOST_PORT");
  await checkDevClient(origin);
  console.log(`Browser dev client ready at ${origin}`);
}
