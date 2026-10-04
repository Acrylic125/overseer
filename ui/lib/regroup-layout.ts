import { buildAllConnectorPaths } from "@/lib/graph/connector-paths";
import type { GroupPlatform } from "@/lib/graph/pack-layout";
import { INTERNET_ID } from "@/lib/internet";
import type { ResourceLayoutResult } from "@/lib/layout-from-db";
import type { GroupingMode } from "@/lib/layout-options";
import type { InfrastructureService } from "@/server/routers/infrastructure";

const GAP = 2;
const PADDING = 1;
const TITLE_SPACE = 2;

/** Repack alternative groupings while preserving scanned resource metadata. */
export function regroupLayout(
  source: ResourceLayoutResult,
  mode: GroupingMode,
): ResourceLayoutResult {
  if (mode === "scanned" || source.services.length === 0) return source;

  const buckets = new Map<string, InfrastructureService[]>();
  for (const service of source.services) {
    const key = mode === "service-type" ? service.type : "";
    const bucket = buckets.get(key) ?? [];
    bucket.push(service);
    buckets.set(key, bucket);
  }

  const clusters = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, members]) => {
      const sorted = [...members].sort(
        (a, b) =>
          a.type.localeCompare(b.type) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );
      const columns = Math.ceil(Math.sqrt(sorted.length));
      const cellWidth = Math.max(...sorted.map((service) => service.width)) + GAP;
      const cellDepth = Math.max(...sorted.map((service) => service.depth)) + GAP;
      const top = mode === "service-type" ? TITLE_SPACE : PADDING;
      return {
        group,
        width: columns * cellWidth - GAP + PADDING * 2,
        depth:
          Math.ceil(sorted.length / columns) * cellDepth - GAP + top + PADDING,
        services: sorted.map((service, index) => ({
          ...service,
          x: PADDING + (index % columns) * cellWidth,
          y: top + Math.floor(index / columns) * cellDepth,
        })),
      };
    });

  const targetWidth = Math.max(
    ...clusters.map((cluster) => cluster.width),
    Math.sqrt(
      clusters.reduce(
        (area, cluster) => area + (cluster.width + GAP) * (cluster.depth + GAP),
        0,
      ),
    ),
  );
  const services: InfrastructureService[] = [];
  const platforms: GroupPlatform[] = [];
  let x = 0;
  let y = 0;
  let rowDepth = 0;
  let width = 0;
  for (const cluster of clusters) {
    if (x > 0 && x + cluster.width > targetWidth) {
      x = 0;
      y += rowDepth + GAP;
      rowDepth = 0;
    }
    services.push(
      ...cluster.services.map((service) => ({
        ...service,
        x: service.x + x,
        y: service.y + y,
      })),
    );
    if (mode === "service-type") {
      platforms.push({
        group: cluster.group,
        centerX: x + cluster.width / 2,
        centerZ: y + cluster.depth / 2,
        width: cluster.width,
        depth: cluster.depth,
      });
    }
    width = Math.max(width, x + cluster.width);
    rowDepth = Math.max(rowDepth, cluster.depth);
    x += cluster.width + GAP;
  }
  const depth = y + rowDepth;
  for (const service of services) {
    service.x -= width / 2;
    service.y -= depth / 2;
  }
  for (const platform of platforms) {
    platform.centerX -= width / 2;
    platform.centerZ -= depth / 2;
  }
  const publicInternet = {
    ...source.publicInternet,
    centerX: -width / 2 - GAP - source.publicInternet.width / 2,
    centerZ: 0,
  };
  const hasInternet = publicInternet.width > 0 && publicInternet.depth > 0;
  const routeServices = hasInternet
    ? [
        ...services,
        {
          ...services[0],
          id: INTERNET_ID,
          x: publicInternet.centerX - publicInternet.width / 2,
          y: publicInternet.centerZ - publicInternet.depth / 2,
          width: publicInternet.width,
          depth: publicInternet.depth,
          connections: [],
        },
      ]
    : services;
  const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
  const routes = new Map(
    buildAllConnectorPaths(routeServices).map((path) => [
      pairKey(path.sourceId, path.targetId),
      path,
    ]),
  );
  const connectorPaths = source.connectorPaths.flatMap((path) => {
    const route = routes.get(pairKey(path.sourceId, path.targetId));
    if (!route) return [];
    return [
      {
        ...path,
        points:
          route.sourceId === path.sourceId
            ? route.points
            : [...route.points].reverse(),
      },
    ];
  });
  const internetSpan = hasInternet ? GAP + publicInternet.width : 0;
  const bounds = {
    centerX: hasInternet ? -internetSpan / 2 : 0,
    centerZ: 0,
    width: width + internetSpan,
    depth: Math.max(depth, hasInternet ? publicInternet.depth : 0),
  };
  return {
    services,
    platforms,
    publicInternet,
    bounds,
    connectorPaths,
    camera: {
      ...source.camera,
      position: [bounds.centerX, source.camera.position[1], bounds.centerZ],
    },
  };
}
