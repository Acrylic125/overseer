import * as THREE from "three";

import { cssToThreeColor } from "@/lib/css-color";
import {
  MATERIAL_ROUGHNESS,
  SCENE,
} from "@/lib/infrastructure-styles";

/** Visible mesh border thickness along block edges. */
export const EDGE_BORDER = 0.01;

/** Shared materials — one set for the whole scene. */
let materials: {
  block: THREE.MeshStandardMaterial;
  border: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  computePad: THREE.MeshStandardMaterial;
  computeIcon: THREE.MeshStandardMaterial;
  storagePad: THREE.MeshStandardMaterial;
  storageIcon: THREE.MeshStandardMaterial;
  databasePad: THREE.MeshStandardMaterial;
  databaseIcon: THREE.MeshStandardMaterial;
} | null = null;

function flatMaterial(cssColor: string) {
  return new THREE.MeshStandardMaterial({
    color: cssToThreeColor(cssColor),
    roughness: 0,
    metalness: 0,
  });
}

export function getBlockMaterials() {
  if (!materials) {
    materials = {
      block: new THREE.MeshStandardMaterial({
        color: cssToThreeColor(SCENE.block),
        roughness: 0,
        metalness: 0,
        flatShading: true,
      }),
      border: new THREE.MeshStandardMaterial({
        color: cssToThreeColor(SCENE.edge),
        roughness: MATERIAL_ROUGHNESS,
        metalness: 0.15,
      }),
      accent: new THREE.MeshStandardMaterial({
        color: cssToThreeColor(SCENE.edge),
        roughness: MATERIAL_ROUGHNESS,
        metalness: 0.1,
      }),
      computePad: flatMaterial(SCENE.computePad),
      computeIcon: flatMaterial(SCENE.computeIcon),
      storagePad: flatMaterial(SCENE.storagePad),
      storageIcon: flatMaterial(SCENE.storageIcon),
      databasePad: flatMaterial(SCENE.databasePad),
      databaseIcon: flatMaterial(SCENE.databaseIcon),
    };
  } else {
    materials.block.color.copy(cssToThreeColor(SCENE.block));
    materials.block.roughness = 0;
    materials.block.metalness = 0;
    materials.block.flatShading = true;
    materials.block.needsUpdate = true;
    materials.computePad.color.copy(cssToThreeColor(SCENE.computePad));
    materials.storagePad.color.copy(cssToThreeColor(SCENE.storagePad));
    materials.databasePad.color.copy(cssToThreeColor(SCENE.databasePad));
  }
  return materials;
}

/** Chamfered rectangle outline — edges stay out, only corners cut inward. */
export function createChamferRectShape(
  width: number,
  depth: number,
  cornerInset: number,
) {
  const hw = width / 2;
  const hd = depth / 2;
  const c = Math.min(cornerInset, hw * 0.45, hd * 0.45);
  const shape = new THREE.Shape();
  // CCW in shape XY (maps to world XZ after extrude+rotate).
  shape.moveTo(hw - c, hd);
  shape.lineTo(hw, hd - c);
  shape.lineTo(hw, -hd + c);
  shape.lineTo(hw - c, -hd);
  shape.lineTo(-hw + c, -hd);
  shape.lineTo(-hw, -hd + c);
  shape.lineTo(-hw, hd - c);
  shape.lineTo(-hw + c, hd);
  shape.closePath();
  return shape;
}

/**
 * Cuboid prism with only corners intruded (chamfered).
 * Vertical walls — not a frustum; edge midpoints stay at full width/depth.
 */
export function createCornerChamferedBoxGeometry(
  width: number,
  depth: number,
  height: number,
  cornerInset: number,
) {
  const shape = createChamferRectShape(width, depth, cornerInset);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** Regular n-gon. `startAngle` 0 matches Three cylinder theta (vertex on +Y in shape). */
export function createRegularPolygonShape(
  sides: number,
  apothem: number,
  startAngle = 0,
) {
  const vertexRadius = apothem / Math.cos(Math.PI / sides);
  const shape = new THREE.Shape();
  for (let i = 0; i < sides; i += 1) {
    const angle = startAngle + (i * 2 * Math.PI) / sides;
    const x = Math.cos(angle) * vertexRadius;
    const y = Math.sin(angle) * vertexRadius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/**
 * Y-rotation applied after extrude so polygon prisms match
 * CylinderGeometry's default hex orientation (vertex along +Z).
 */
export const POLYGON_Y_ALIGN = Math.PI / 2;

/** Solid regular polygon prism (pad badges + hex cells). */
export function createPolygonPrismGeometry(
  sides: number,
  apothem: number,
  height: number,
) {
  const geometry = new THREE.ExtrudeGeometry(
    createRegularPolygonShape(sides, apothem),
    { depth: height, bevelEnabled: false },
  );
  geometry.rotateX(-Math.PI / 2);
  // Match CylinderGeometry vertex convention (sin/cos vs cos/-sin after rotateX).
  geometry.rotateY(POLYGON_Y_ALIGN);
  return geometry;
}

/** Hollow polygonal bucket with rim + interior intrusion. */
export function createPolygonBucketGeometry(
  sides: number,
  apothem: number,
  height: number,
  rim: number,
  intrusion: number,
) {
  const innerApothem = Math.max(apothem - rim, apothem * 0.35);
  const cavityFloor = Math.max(height - intrusion, height * 0.2);

  const outer = createRegularPolygonShape(sides, apothem);
  const inner = createRegularPolygonShape(sides, innerApothem);
  outer.holes.push(inner);

  const rimGeo = new THREE.ExtrudeGeometry(outer, {
    depth: rim,
    bevelEnabled: false,
  });
  rimGeo.rotateX(-Math.PI / 2);
  rimGeo.rotateY(POLYGON_Y_ALIGN);
  rimGeo.translate(0, height - rim, 0);

  const wall = createRegularPolygonShape(sides, apothem);
  wall.holes.push(createRegularPolygonShape(sides, innerApothem));
  const wallGeo = new THREE.ExtrudeGeometry(wall, {
    depth: height - rim - cavityFloor,
    bevelEnabled: false,
  });
  wallGeo.rotateX(-Math.PI / 2);
  wallGeo.rotateY(POLYGON_Y_ALIGN);
  wallGeo.translate(0, cavityFloor, 0);

  const floorGeo = new THREE.ExtrudeGeometry(
    createRegularPolygonShape(sides, apothem),
    {
      depth: cavityFloor,
      bevelEnabled: false,
    },
  );
  floorGeo.rotateX(-Math.PI / 2);
  floorGeo.rotateY(POLYGON_Y_ALIGN);

  return mergeGeometries([floorGeo, wallGeo, rimGeo]);
}

function mergeGeometries(geometries: THREE.BufferGeometry[]) {
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let indexOffset = 0;

  for (const geometry of geometries) {
    geometry.computeVertexNormals();
    const pos = geometry.getAttribute("position");
    const nor = geometry.getAttribute("normal");
    const idx = geometry.getIndex();
    if (!pos) continue;

    for (let i = 0; i < pos.count; i += 1) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (nor) normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      else normals.push(0, 1, 0);
    }

    if (idx) {
      for (let i = 0; i < idx.count; i += 1) {
        indices.push(idx.getX(i) + indexOffset);
      }
    } else {
      for (let i = 0; i < pos.count; i += 1) {
        indices.push(indexOffset + i);
      }
    }
    indexOffset += pos.count;
    geometry.dispose();
  }

  merged.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

/** Hex cell — same orientation as polygon pads (apothem from circumradius). */
export function createHexPrismGeometry(radius: number, height: number) {
  const apothem = radius * Math.cos(Math.PI / 6);
  return createPolygonPrismGeometry(6, apothem, height);
}

export type EdgeSegment = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  length: number;
  mid: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

/** Keep vertical edges and edges that sit on the top face. */
export function filterVerticalAndTopEdges(
  segments: EdgeSegment[],
  topY: number,
  tolerance = 0.04,
): EdgeSegment[] {
  return segments.filter((segment) => {
    const dy = Math.abs(segment.end.y - segment.start.y);
    if (dy / segment.length > 0.7) return true;
    const minY = Math.min(segment.start.y, segment.end.y);
    return minY >= topY - tolerance;
  });
}

/** Unique hard edges as oriented segments for mesh borders. */
export function extractEdgeSegments(
  geometry: THREE.BufferGeometry,
  angleThreshold = 30,
): EdgeSegment[] {
  const edges = new THREE.EdgesGeometry(geometry, angleThreshold);
  const pos = edges.getAttribute("position");
  const yAxis = new THREE.Vector3(0, 1, 0);
  const segments: EdgeSegment[] = [];

  if (pos) {
    for (let i = 0; i < pos.count; i += 2) {
      const start = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const end = new THREE.Vector3(
        pos.getX(i + 1),
        pos.getY(i + 1),
        pos.getZ(i + 1),
      );
      const dir = new THREE.Vector3().subVectors(end, start);
      const length = dir.length();
      if (length < 1e-6) continue;
      dir.multiplyScalar(1 / length);
      const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
      segments.push({ start, end, length, mid, quaternion });
    }
  }

  edges.dispose();
  return segments;
}
