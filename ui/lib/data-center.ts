import type { ConnectorPath } from "@/lib/graph/connector-paths";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type VisualizationStyle = "default" | "data-center";
export type BuildingKind =
  "warehouse" | "rack" | "database" | "gantry" | "watchtower" | "gateway" | "gate";

export const DATA_CENTER = {
  background: "#ffffff",
  surface: "#fffdf8",
  recessed: "#f5eee2",
  ink: "#70442e",
  compute: "#ff791f",
  storage: "#ff791f",
  database: "#ff791f",
  integration: "#ff791f",
  fitting: "#ff9a38",
  panel: "#faf5ec",
  platform: "#fdfbf7",
  platformEdge: "#cdbb9f",
  platformSide: "#f2ece2",
  amber: "#ffa62b",
  packet: "#ffae38",
} as const;

/** Provider identifiers take precedence over the older, broad category metadata. */
export function buildingKind(
  service: Pick<InfrastructureService, "type" | "category" | "species">,
): BuildingKind {
  const type = service.type.toLowerCase();
  if (type === "cloud" || /(?:^|[-_])dns$|route[-_]?53/.test(type)) return "gateway";
  if (/azure[-_]?ad|azure[-_]?entra|entra|active[-_ ]?directory|auth0|okta|cognito/.test(type))
    return "gate";
  if (/event[-_]?bridge|event[-_]?bus/.test(type))
    return "watchtower";
  if (/queue|sqs|kinesis|pub[-_]?sub|service[-_]?bus/.test(type))
    return "gantry";
  if (
    /database|dynamo|rds|aurora|sql|redis|mongo|postgres|(?:^|-)d1$|(?:^|-)kv$|vectorize/.test(
      type,
    )
  )
    return "database";
  if (/storage|bucket|(?:^|-)s3$|(?:^|-)r2$|blob/.test(type))
    return "warehouse";
  if (service.category === "database") return "database";
  if (service.category === "storage") return "warehouse";
  // Integration metadata historically assigns every application the queue species.
  // Actual queues are recognized by their provider type above.
  if (service.category === "integration") return "gate";
  if (service.species === "queue") return "gantry";
  return "rack";
}

export function buildingAccent(kind: BuildingKind) {
  return kind === "warehouse"
    ? DATA_CENTER.storage
    : kind === "database"
      ? DATA_CENTER.database
      : kind === "rack"
        ? DATA_CENTER.compute
        : DATA_CENTER.integration;
}

export function buildingHeight(kind: BuildingKind) {
  return kind === "gate" ? 1.2 : kind === "gateway" ? 1.7 : kind === "watchtower" ? 2.9 : kind === "gantry" ? 1.95 : 1.8;
}

export function hologramLift(service: Pick<InfrastructureService, "width">) {
  return service.width >= 1.5 ? 0.5 : 0;
}

/** Enclose the actual service lots, avoiding empty paddocks in this style. */
export function dataCenterLotFootprints(
  platforms: PackLayoutResult["platforms"],
  services: InfrastructureService[],
): PackLayoutResult["platforms"] {
  return platforms.map((lot) => {
    const group = lot.group;
    if (!group) return lot;
    const members = services.filter(s => s.group === group || s.group.startsWith(`${group}/`));
    if (!members.length) return lot;
    const minX = Math.min(...members.map(s => s.x)) - 0.6;
    const maxX = Math.max(...members.map(s => s.x + s.width)) + 0.6;
    const minZ = Math.min(...members.map(s => s.y)) - 0.6;
    const maxZ = Math.max(...members.map(s => s.y + s.depth)) + 0.6;
    return { ...lot, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2, width: maxX - minX, depth: maxZ - minZ };
  });
}

export function dataCenterPickHeight(service: InfrastructureService) {
  return buildingHeight(buildingKind(service)) + 0.15;
}

/** Carry belts across the threshold instead of stopping outside open doors. */
export function dataCenterTransportPaths(paths: ConnectorPath[], services: InfrastructureService[]): ConnectorPath[] {
  const byId = new Map(services.map(service => [service.id, service]));
  return paths.map(path => {
    const points = [...path.points];
    for (const source of [true, false]) {
      const service = byId.get(source ? path.sourceId : path.targetId);
      if (!service || !["warehouse", "gate"].includes(buildingKind(service))) continue;
      const ordered = source ? path.points : [...path.points].reverse();
      const port = ordered[0];
      if (!port) continue;
      const next = ordered.find(p => Math.hypot(p.x - port.x, p.z - port.z) > 1e-6);
      if (!next) continue;
      const length = Math.hypot(next.x - port.x, next.z - port.z);
      const inset = Math.min(0.32, Math.min(service.width, service.depth) * 0.3);
      const tip = { x: port.x - (next.x - port.x) / length * inset, z: port.z - (next.z - port.z) / length * inset };
      if (source) points.unshift(tip);
      else points.push(tip);
    }
    return { ...path, points };
  });
}

export type PacketRoute = {
  path: ConnectorPath;
  segments: {
    x: number;
    z: number;
    dx: number;
    dz: number;
    length: number;
    end: number;
  }[];
  length: number;
};

/** Cumulative world distances keep packet speed constant through corners. */
export function packetRoute(path: ConnectorPath): PacketRoute {
  let length = 0;
  const segments: PacketRoute["segments"] = [];
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1]!;
    const b = path.points[i]!;
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance < 1e-6) continue;
    length += distance;
    segments.push({
      x: a.x,
      z: a.z,
      dx: (b.x - a.x) / distance,
      dz: (b.z - a.z) / distance,
      length: distance,
      end: length,
    });
  }
  return { path, segments, length };
}

export function packetPosition(route: PacketRoute, distance: number) {
  if (!route.segments.length || route.length === 0) return null;
  const wrapped = ((distance % route.length) + route.length) % route.length;
  const segment =
    route.segments.find((item) => wrapped < item.end) ??
    route.segments[route.segments.length - 1]!;
  const along = wrapped - (segment.end - segment.length);
  return {
    x: segment.x + segment.dx * along,
    z: segment.z + segment.dz * along,
    angle: Math.atan2(segment.dx, segment.dz),
  };
}

/** Round the conveyor centerline and packet trajectory, leaving ports fixed. */
export function conveyorPacketRoute(path: ConnectorPath): PacketRoute {
  const original = packetRoute(path);
  if (original.segments.length < 2) return original;
  const points = [{ x: original.segments[0]!.x, z: original.segments[0]!.z }];
  for (let i = 1; i < original.segments.length; i++) {
    const incoming = original.segments[i - 1]!;
    const outgoing = original.segments[i]!;
    const corner = { x: outgoing.x, z: outgoing.z };
    if (Math.abs(incoming.dx * outgoing.dz - incoming.dz * outgoing.dx) < 1e-6) {
      points.push(corner);
      continue;
    }
    const radius = Math.min(0.4, incoming.length * 0.48, outgoing.length * 0.48);
    const start = { x: corner.x - incoming.dx * radius, z: corner.z - incoming.dz * radius };
    const end = { x: corner.x + outgoing.dx * radius, z: corner.z + outgoing.dz * radius };
    points.push(start);
    for (let step = 1; step <= 8; step++) {
      const t = step / 8;
      points.push({
        x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * corner.x + t ** 2 * end.x,
        z: (1 - t) ** 2 * start.z + 2 * (1 - t) * t * corner.z + t ** 2 * end.z,
      });
    }
  }
  const last = original.segments.at(-1)!;
  points.push({ x: last.x + last.dx * last.length, z: last.z + last.dz * last.length });
  return packetRoute({ ...path, points });
}
