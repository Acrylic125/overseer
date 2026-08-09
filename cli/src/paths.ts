import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Package root (`scan/`). */
export const scanRoot = path.resolve(__dirname, "..");
/** Monorepo root. */
export const repoRoot = path.resolve(scanRoot, "..");

export const envPath = path.join(scanRoot, ".env");
export const uiEnvPath = path.join(repoRoot, "ui", ".env");

/** SVG sources live under `scan/assets/` (inputs, not generated). */
export const assetsRoot = path.join(scanRoot, "assets");
export const assetsIconsDir = path.join(assetsRoot, "icons");
export const assetsShapesDir = path.join(assetsRoot, "shapes");

export const ARTIFACT_ASSETS_GLB = "assets.glb";
export const ARTIFACT_GRADIENT_PNG = "platform-gradient.png";
export const ARTIFACT_INFRASTRUCTURE_JSON = "infrastructure.json";

/**
 * Artifact output directory: `./_generated` under cwd, or `--dir <path>`.
 * All generated files are written flat into this directory.
 */
export function resolveOutDir(dirFlag?: string): string {
  return path.resolve(process.cwd(), dirFlag ?? "_generated");
}

export function artifactPath(outDir: string, name: string): string {
  return path.join(outDir, name);
}
