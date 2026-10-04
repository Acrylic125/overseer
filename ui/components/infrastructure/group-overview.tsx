"use client";

import { Html, Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useMemo } from "react";

import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export function GroupOverview({ services, platforms }: {
  services: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
}) {
  const { camera } = useThree();
  const { groups, links } = useMemo(() => {
    const groups = platforms.filter((platform) => platform.group && !platform.group.includes("/"))
      .map((platform) => ({ ...platform, count: 0 }));
    const byGroup = new Map(groups.map((group) => [group.group, group]));
    const memberships = new Map<string, string>();
    for (const service of services) {
      const name = service.group.split("/")[0]!;
      const group = byGroup.get(name);
      if (!group) continue;
      group.count += 1;
      memberships.set(service.id, name);
    }
    const links = new Map<string, { from: typeof groups[number]; to: typeof groups[number]; count: number }>();
    for (const service of services) {
      const from = byGroup.get(memberships.get(service.id) ?? null);
      if (!from) continue;
      for (const target of service.dependsOn) {
        const to = byGroup.get(memberships.get(target) ?? null);
        if (!to || from === to) continue;
        const key = `${from.group}\0${to.group}`;
        const link = links.get(key);
        if (link) link.count += 1;
        else links.set(key, { from, to, count: 1 });
      }
    }
    return { groups, links: [...links.values()] };
  }, [services, platforms]);
  return (
    <group>
      {links.map(({ from, to, count }) => (
        <group key={`${from.group}:${to.group}`}>
          <Line points={[[from.centerX, 0.12, from.centerZ], [to.centerX, 0.12, to.centerZ]]}
            color="#8ec7ff" lineWidth={Math.min(5, 1 + Math.log2(count))} />
          <Html center position={[(from.centerX + to.centerX) / 2, 0.15, (from.centerZ + to.centerZ) / 2]}>
            <span className="pointer-events-none whitespace-nowrap rounded bg-black/80 px-2 py-1 text-xs text-blue-100">{count} {count === 1 ? "link" : "links"}</span>
          </Html>
        </group>
      ))}
      {groups.map((group) => (
        <Html center key={group.group ?? group.id} position={[group.centerX, 0.2, group.centerZ]}>
          <button type="button" className="min-w-28 rounded-lg border border-white/20 bg-slate-950/95 px-4 py-3 text-left text-white shadow-lg hover:border-blue-300 focus-visible:outline-2 focus-visible:outline-blue-300"
            onClick={() => camera.position.set(group.centerX, 32, group.centerZ)}>
            <span className="block max-w-56 truncate text-sm font-medium">{group.group}</span>
            <span className="block text-xs text-slate-300">{group.count} resources · Zoom in</span>
          </button>
        </Html>
      ))}
    </group>
  );
}
