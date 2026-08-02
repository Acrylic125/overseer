import type { InfrastructureService } from "@/server/routers/infrastructure";
import { CELL_SIZE } from "@/lib/infrastructure-styles";

export type VeinSegment = {
  id: string;
  /** Catmull-Rom control points in world space */
  points: [number, number, number][];
  radius: number;
  /** 0 healthy teal … 1 hot / high latency */
  heat: number;
  sourceIds: string[];
  targetId: string;
};

const FAN_IN_TRUNK_THRESHOLD = 4;

function worldPos(service: InfrastructureService, y = 0.35): [number, number, number] {
  return [service.x * CELL_SIZE, y, service.y * CELL_SIZE];
}

function midHigh(
  a: [number, number, number],
  b: [number, number, number],
  lift = 1.2,
): [number, number, number] {
  return [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + lift, (a[2] + b[2]) / 2];
}

/**
 * Build curved vein segments with trunk bundling for high fan-in targets.
 */
export function buildVeinSegments(
  services: InfrastructureService[],
): VeinSegment[] {
  const byId = new Map(services.map((s) => [s.id, s]));
  const incoming = new Map<string, string[]>();

  for (const service of services) {
    for (const targetId of service.connections) {
      if (!byId.has(targetId) || targetId === service.id) continue;
      const list = incoming.get(targetId) ?? [];
      list.push(service.id);
      incoming.set(targetId, list);
    }
  }

  const segments: VeinSegment[] = [];

  for (const [targetId, sources] of incoming) {
    const target = byId.get(targetId);
    if (!target) continue;
    const targetPos = worldPos(target, speciesHeight(target.species));

    if (sources.length >= FAN_IN_TRUNK_THRESHOLD) {
      // Confluence just short of the target
      let cx = 0;
      let cz = 0;
      for (const sourceId of sources) {
        const source = byId.get(sourceId)!;
        cx += source.x * CELL_SIZE;
        cz += source.y * CELL_SIZE;
      }
      cx /= sources.length;
      cz /= sources.length;

      const confluence: [number, number, number] = [
        (cx * 0.35 + targetPos[0] * 0.65),
        targetPos[1] + 0.8,
        (cz * 0.35 + targetPos[2] * 0.65),
      ];

      const heat = averageHeat(sources, byId);
      segments.push({
        id: `trunk-${targetId}`,
        points: [
          confluence,
          midHigh(confluence, targetPos, 0.4),
          targetPos,
        ],
        radius: 0.08 + Math.min(0.12, sources.length * 0.004),
        heat,
        sourceIds: sources,
        targetId,
      });

      for (const sourceId of sources) {
        const source = byId.get(sourceId)!;
        const sourcePos = worldPos(source, speciesHeight(source.species));
        segments.push({
          id: `feed-${sourceId}-${targetId}`,
          points: [
            sourcePos,
            midHigh(sourcePos, confluence, 1.4),
            confluence,
          ],
          radius: 0.025,
          heat: latencyHeat(source.metrics.latencyMs),
          sourceIds: [sourceId],
          targetId,
        });
      }
      continue;
    }

    for (const sourceId of sources) {
      const source = byId.get(sourceId)!;
      const sourcePos = worldPos(source, speciesHeight(source.species));
      segments.push({
        id: `edge-${sourceId}-${targetId}`,
        points: [
          sourcePos,
          midHigh(sourcePos, targetPos, 1.6),
          targetPos,
        ],
        radius: 0.035,
        heat: latencyHeat(source.metrics.latencyMs),
        sourceIds: [sourceId],
        targetId,
      });
    }
  }

  return segments;
}

function speciesHeight(
  species: InfrastructureService["species"],
): number {
  switch (species) {
    case "database":
      return 0.35;
    case "queue":
      return 0.7;
    case "cdn_edge":
      return 1.4;
    case "load_balancer":
      return 1.1;
    case "api_gateway":
      return 0.85;
    default:
      return 0.45;
  }
}

function latencyHeat(latencyMs: number) {
  return Math.min(1, Math.max(0, (latencyMs - 40) / 400));
}

function averageHeat(
  sourceIds: string[],
  byId: Map<string, InfrastructureService>,
) {
  let sum = 0;
  for (const id of sourceIds) {
    sum += latencyHeat(byId.get(id)?.metrics.latencyMs ?? 80);
  }
  return sum / Math.max(sourceIds.length, 1);
}

/** Ids in the selected node's upstream/downstream neighborhood. */
export function relatedNodeIds(
  selectedId: string | null,
  services: InfrastructureService[],
): Set<string> | null {
  if (!selectedId) return null;
  const related = new Set<string>([selectedId]);
  const byId = new Map(services.map((s) => [s.id, s]));
  const selected = byId.get(selectedId);
  if (!selected) return related;

  for (const target of selected.connections) related.add(target);
  for (const service of services) {
    if (service.connections.includes(selectedId)) related.add(service.id);
  }
  return related;
}
