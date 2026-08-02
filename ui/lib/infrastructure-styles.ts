import type {
  InfrastructureCategory,
  InfrastructureSpecies,
} from "@/server/routers/infrastructure";

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
} as const;

export const PLATFORM_THICKNESS = 0.15;
/** Margin (cells) of platform beyond the group's block footprints. */
export const PLATFORM_PAD = 0.75;
/** Minimum edge-to-edge gap between group platforms (cells). */
export const PLATFORM_SEPARATION = 4;
export const BLOCK_GAP = 1;
export const MATERIAL_ROUGHNESS = 0.28;
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
  object_storage: { accent: SCENE.edge, label: "Object Storage" },
};

export function speciesToCategory(
  species: InfrastructureSpecies,
): InfrastructureCategory {
  switch (species) {
    case "database":
      return "database";
    case "object_storage":
      return "storage";
    case "queue":
      return "integration";
    default:
      return "compute";
  }
}
