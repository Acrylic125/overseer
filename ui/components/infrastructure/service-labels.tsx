"use client";

import { Text } from "@react-three/drei";
import { useMemo } from "react";

import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import { CELL_SIZE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

/** Labels sit just above icons (icon y = 0.01). */
const LABEL_Y = 0.02;
const LABEL_FONT = 0.22;
const LABEL_LINE_HEIGHT = 1.15;
/** Gap below the icon footprint to the label. */
const LABEL_GAP = 0.35;
/** Lie flat on XZ (facing +Y). */
const FLAT_ON_GROUND: [number, number, number] = [-Math.PI / 2, 0, 0];
const MAX_LABEL_LINES = 2;
/** Extra width beyond the service footprint. */
const LABEL_WIDTH_PAD = 0.4;
/**
 * Conservative average glyph advance (Noto Sans). Too low and Troika would
 * re-wrap our lines; we also render with `nowrap` to forbid that.
 */
const CHAR_WIDTH_FACTOR = 0.62;

type LabelPose = {
  id: string;
  lines: string[];
  position: [number, number, number];
};

/**
 * Wrap to `maxWidth` and return at most `maxLines` lines, with an ellipsis on
 * the last line when the full name does not fit.
 */
export function clampServiceLabelLines(
  name: string,
  maxWidth: number,
  fontSize: number,
  maxLines = MAX_LABEL_LINES,
): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];

  const cols = Math.max(
    1,
    Math.floor(maxWidth / (fontSize * CHAR_WIDTH_FACTOR)),
  );
  const lines: string[] = [];
  let cursor = 0;

  while (cursor < trimmed.length && lines.length < maxLines) {
    while (trimmed[cursor] === " ") cursor += 1;
    if (cursor >= trimmed.length) break;

    let end = Math.min(cursor + cols, trimmed.length);
    if (end < trimmed.length) {
      const space = trimmed.lastIndexOf(" ", end);
      if (space > cursor) end = space;
    }

    let chunk = trimmed.slice(cursor, end).trimEnd();
    // Hard-cap in case a single word exceeds cols (no space to break on).
    if (chunk.length > cols) chunk = chunk.slice(0, cols);

    cursor = Math.max(end, cursor + chunk.length);
    while (trimmed[cursor] === " ") cursor += 1;

    const hasMore = cursor < trimmed.length;
    const isLastLine = lines.length === maxLines - 1;

    if (isLastLine && hasMore) {
      const budget = Math.max(1, cols - 1);
      if (chunk.length > budget) chunk = chunk.slice(0, budget).trimEnd();
      lines.push(`${chunk}…`);
      break;
    }

    if (chunk.length > 0) lines.push(chunk);
  }

  return lines.slice(0, maxLines);
}

/**
 * Service name labels as troika Text, laid flat on the ground plane.
 * Width ≤ block + pad; hard-capped to 2 lines (each rendered `nowrap`).
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
      const maxWidth = Math.max(
        service.width * CELL_SIZE + LABEL_WIDTH_PAD,
        LABEL_FONT,
      );
      const labelZ = (service.depth * CELL_SIZE) / 2 + LABEL_GAP;
      out.push({
        id: service.id,
        lines: clampServiceLabelLines(service.name, maxWidth, LABEL_FONT),
        position: [x, LABEL_Y, z + labelZ],
      });
    }
    return out;
  }, [services]);

  const linePitch = LABEL_FONT * LABEL_LINE_HEIGHT;

  return (
    <group>
      {poses.map((pose) => (
        <group key={pose.id} position={pose.position} rotation={FLAT_ON_GROUND}>
          {pose.lines.map((line, index) => (
            <Text
              key={`${pose.id}:${index}`}
              fontSize={LABEL_FONT}
              color="#E2E8F0"
              anchorX="center"
              anchorY="top"
              position={[0, -index * linePitch, 0]}
              whiteSpace="nowrap"
              textAlign="center"
              renderOrder={2}
            >
              {line}
            </Text>
          ))}
        </group>
      ))}
    </group>
  );
}
