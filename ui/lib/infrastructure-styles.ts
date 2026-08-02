import type {
  InfrastructureCategory,
  InfrastructureSpecies,
} from "@/server/routers/infrastructure";

/** World units per grid cell — matches default 1×1 block footprint. */
export const CELL_SIZE = 1;

export const SCENE = {
  background: "oklch(14.5% 0 0)",
  block: "#ffffff",
  edge: "oklch(37.2% 0.044 257.287)",
  platform: "oklch(92.9% 0.013 255.508)",
  computePad: "oklch(94.5% 0.129 101.54)",
  computeIcon: "oklch(55.4% 0.135 66.442)",
  storagePad: "oklch(92.5% 0.084 155.995)",
  storageIcon: "oklch(52.7% 0.154 150.069)",
  databasePad: "oklch(88.2% 0.059 254.128)",
  databaseIcon: "oklch(54.6% 0.245 262.881)",
  gridMinor: "oklch(37.2% 0.044 257.287)",
  gridMajor: "oklch(55% 0.04 257)",
  ambient: "oklch(70% 0.02 257)",
  keyLight: "oklch(95% 0.01 95)",
  hemiSky: "oklch(80% 0.02 250)",
  hemiGround: "oklch(25% 0.02 257)",
  connector: "oklch(51.8% 0.253 323.949)",
} as const;

export const PLATFORM_THICKNESS = 0.15;
/** Margin (cells) of platform beyond the group's block footprints. */
export const PLATFORM_PAD = 0.75;
/** Minimum edge-to-edge gap between group platforms (cells). */
export const PLATFORM_SEPARATION = 4;
export const BLOCK_GAP = 1;
export const MATERIAL_ROUGHNESS = 0.05;
export const GRID_MAJOR_EVERY = 4;
/** World-space extent of the infinite-feeling floor grid. */
export const GRID_EXTENT = 120;

export const SPECIES_STYLE: Record<
  InfrastructureSpecies,
  { accent: string; label: string }
> = {
  database: { accent: SCENE.edge, label: "Database" },
  api_gateway: { accent: SCENE.edge, label: "API Gateway" },
  microservice: { accent: SCENE.edge, label: "Microservice" },
  queue: { accent: SCENE.edge, label: "Queue" },
  cdn_edge: { accent: SCENE.edge, label: "CDN / Edge" },
  load_balancer: { accent: SCENE.edge, label: "Load Balancer" },
};

export function speciesToCategory(
  species: InfrastructureSpecies,
): InfrastructureCategory {
  switch (species) {
    case "database":
      return "database";
    case "queue":
      return "storage";
    default:
      return "compute";
  }
}
