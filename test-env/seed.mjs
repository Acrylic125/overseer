import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./graph.json", import.meta.url));
const destination = process.env.OVERSEER_GRAPH_PATH;
if (!destination) throw new Error("OVERSEER_GRAPH_PATH must identify this instance's local data file");
JSON.parse(await readFile(fixture, "utf8"));
await mkdir(path.dirname(destination), { recursive: true });
try {
  await copyFile(fixture, destination, constants.COPYFILE_EXCL);
  console.log(`Seeded local infrastructure at ${destination}`);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log(`Keeping existing instance data at ${destination}`);
}
