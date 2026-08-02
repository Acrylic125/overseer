"use client";

import { Text } from "@react-three/drei";

import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import { CELL_SIZE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

const BASE_HEIGHT = 0.12;
const FONT_SIZE = 0.18;
const LINE_HEIGHT = 1.15;
const MAX_LINES = 2;

export function ServiceLabels({
  services,
}: {
  services: InfrastructureService[];
}) {
  return (
    <group>
      {services.map((service) => {
        const [x, , z] = serviceWorldCenter(service);
        const labelZ = (service.depth * CELL_SIZE) / 2 + 0.15;
        // Stay inside the block footprint so neighbors don't collide.
        const maxWidth = Math.max(service.width * CELL_SIZE * 0.92, 0.55);
        const clipBottom = -(FONT_SIZE * LINE_HEIGHT * MAX_LINES);

        return (
          <Text
            key={service.id}
            position={[x, BASE_HEIGHT + 0.02, z + labelZ]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={FONT_SIZE}
            lineHeight={LINE_HEIGHT}
            fontWeight="medium"
            color="#d7dde5"
            maxWidth={maxWidth}
            textAlign="center"
            whiteSpace="normal"
            overflowWrap="break-word"
            anchorX="center"
            anchorY="top"
            clipRect={[-maxWidth / 2, clipBottom, maxWidth / 2, FONT_SIZE * 0.25]}
            renderOrder={2}
            frustumCulled
          >
            {service.name}
          </Text>
        );
      })}
    </group>
  );
}
