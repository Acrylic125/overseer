import type {
  InfrastructureSpecies,
  InfrastructureZone,
  NodeHealth,
} from "@/server/routers/infrastructure";

/** World units per grid cell */
export const CELL_SIZE = 1.4;

export const SCENE = {
  background: "#0a0c14",
  ambient: "#0b1220",
  moonlight: "#c5d4e8",
  table: "#07090f",
  tableReflect: 0.15,
  zoneLine: "#1e2a44",
  radar: "#3d7ea6",
  label: "#d7e2f0",
  panel: "#0e1524",
  panelBorder: "#3a6f8f",
} as const;

/** Restrained accent system */
export const ACCENT = {
  data: "#2ec4b6", // cyan/teal — databases, storage, persistence
  compute: "#f0d5a8", // warm white/amber — APIs, services, workers
  edge: "#a78bfa", // lavender/violet — CDN, DNS, external
  alertWarning: "#f59e0b",
  alertCritical: "#ef4444",
  healthyGlow: "#e8f7f5",
} as const;

export const SPECIES_STYLE: Record<
  InfrastructureSpecies,
  {
    accent: string;
    emissive: string;
    label: string;
  }
> = {
  database: {
    accent: ACCENT.data,
    emissive: ACCENT.data,
    label: "Database",
  },
  api_gateway: {
    accent: ACCENT.compute,
    emissive: ACCENT.compute,
    label: "API Gateway",
  },
  microservice: {
    accent: ACCENT.compute,
    emissive: ACCENT.compute,
    label: "Microservice",
  },
  queue: {
    accent: ACCENT.data,
    emissive: ACCENT.data,
    label: "Queue",
  },
  cdn_edge: {
    accent: ACCENT.edge,
    emissive: ACCENT.edge,
    label: "CDN / Edge",
  },
  load_balancer: {
    accent: ACCENT.edge,
    emissive: ACCENT.healthyGlow,
    label: "Load Balancer",
  },
};

export const HEALTH_GLOW: Record<
  NodeHealth,
  { color: string; intensity: number; pulse: number }
> = {
  healthy: { color: ACCENT.healthyGlow, intensity: 0.35, pulse: 0.15 },
  warning: { color: ACCENT.alertWarning, intensity: 0.55, pulse: 0.85 },
  critical: { color: ACCENT.alertCritical, intensity: 0.95, pulse: 2.4 },
};

export const ZONE_META: Record<
  InfrastructureZone,
  { label: string; color: string }
> = {
  payment: { label: "Payment Zone", color: "#1a2740" },
  auth: { label: "Auth Zone", color: "#1c2038" },
  edge: { label: "Edge Zone", color: "#1a1830" },
  data: { label: "Data Zone", color: "#102428" },
  compute: { label: "Compute Zone", color: "#241c14" },
};

export function speciesToCategory(
  species: InfrastructureSpecies,
): "compute" | "storage" | "database" {
  switch (species) {
    case "database":
      return "database";
    case "queue":
      return "storage";
    default:
      return "compute";
  }
}
