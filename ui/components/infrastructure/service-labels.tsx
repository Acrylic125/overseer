"use client";

import { Text } from "@react-three/drei";
import { useMemo } from "react";

import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import { CELL_SIZE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

/** Labels sit just above icons (icon y = 0.01). */
const LABEL_Y = 0.02;
const LABEL_FONT = 0.22;
/** Gap below the icon footprint to the label. */
const LABEL_GAP = 0.35;
/** Lie flat on XZ (facing +Y). */
const FLAT_ON_GROUND: [number, number, number] = [-Math.PI / 2, 0, 0];

type LabelPose = {
  id: string;
  name: string;
  position: [number, number, number];
};

/**
 * Service name labels as troika Text, laid flat on the ground plane.
 */
export function ServiceLabels({
  services,
}: {
  services: InfrastructureService[];
}) {
  const poses = useMemo(() => {
    const out: LabelPose[] = [];
    for (const service of services) {
      const [x, , z] = serviceWorldCenter(service);
      const labelZ = (service.depth * CELL_SIZE) / 2 + LABEL_GAP;
      out.push({
        id: service.id,
        name: service.name,
        position: [x, LABEL_Y, z + labelZ],
      });
    }
    return out;
  }, [services]);

  return (
    <group>
      {poses.map((pose) => (
        <group key={pose.id} position={pose.position} rotation={FLAT_ON_GROUND}>
          <Text
            fontSize={LABEL_FONT}
            color="#E2E8F0"
            anchorX="center"
            anchorY="middle"
            renderOrder={2}
          >
            {pose.name}
          </Text>
        </group>
      ))}
    </group>
  );
}
