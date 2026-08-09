/** World units per grid cell — matches default 1×1 block footprint. */
export const CELL_SIZE = 1;

export const SCENE = {
  background: "#05070d",
  block: "#26364b",
  blockTop: "#40516a",
  edge: "#111827",
  platform: "oklch(37.2% 0.044 257.287)",
  computePad: "#6b380d",
  computeIcon: "#ffbe88",
  storagePad: "#1e4e22",
  storageIcon: "#98d399",
  databasePad: "#274c7b",
  databaseIcon: "#97cfff",
  integrationPad: "#0f4a4e",
  integrationIcon: "#7ddee0",
  /** White icon face — SVG mask applied later. */
  iconFace: "#ffffff",
  /** Baseplates match the light icon accents. */
  computeBase: "#ffbe88",
  storageBase: "#98d399",
  databaseBase: "#97cfff",
  integrationBase: "#7ddee0",
  healthy: "#46c47c",
  warning: "#e6ad3c",
  critical: "#df5a5a",
  gridMinor: "#1b2638",
  gridMajor: "#34445d",
  ambient: "#b9c7da",
  keyLight: "#ffffff",
  hemiSky: "#a9c8f0",
  hemiGround: "#202936",
  connector: "oklch(37.2% 0.044 257.287)",
  /** Bright accent for connectors linked to the selected service. */
  connectorHighlight: "#8ec7ff",
  /** Public-internet cloud mass. */
  publicInternet: "oklch(37.2% 0.044 257.287)",
} as const;

export const PLATFORM_THICKNESS = 0.15;
/** Margin (cells) of platform beyond the group's block footprints. */
export const PLATFORM_PAD = 0.75;
/** Minimum edge-to-edge gap between group platforms (cells). */
export const PLATFORM_SEPARATION = 4;
/**
 * Public-internet cloud footprint at 1 service platform.
 * Aspect ≈ `scan/assets/shapes/cloud.svg` (647×318 ≈ 2:1).
 * Actual size = BASE * sqrt(platformCount), rounded per axis.
 */
export const PUBLIC_INTERNET_BASE_WIDTH = 4;
export const PUBLIC_INTERNET_BASE_DEPTH = 2;

/** Cloud platform width×depth in cells for a given service-platform count. */
export function publicInternetFootprint(platformCount: number) {
  const n = Math.max(1, platformCount);
  const s = Math.sqrt(n);
  return {
    width: Math.max(
      PUBLIC_INTERNET_BASE_WIDTH,
      Math.round(PUBLIC_INTERNET_BASE_WIDTH * s),
    ),
    depth: Math.max(
      PUBLIC_INTERNET_BASE_DEPTH,
      Math.round(PUBLIC_INTERNET_BASE_DEPTH * s),
    ),
  };
}

export const BLOCK_GAP = 1.5;
export const MATERIAL_ROUGHNESS = 0.28;
export const GRID_MAJOR_EVERY = 4;
/** World-space extent of the infinite-feeling floor grid. */
export const GRID_EXTENT = 120;
