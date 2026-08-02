import * as THREE from "three";

import { cssToThreeColor } from "@/lib/css-color";
import {
  MATERIAL_ROUGHNESS,
  SCENE,
} from "@/lib/infrastructure-styles";

/** Visible mesh border thickness along block edges. */
export const EDGE_BORDER = 0.01;

/** Shared geometries — identical 1×1 footprints reuse one BufferGeometry. */
const geometryPool = new Map<string, THREE.BufferGeometry>();

export function getPooledGeometry(
  key: string,
  factory: () => THREE.BufferGeometry,
): THREE.BufferGeometry {
  let geometry = geometryPool.get(key);
  if (!geometry) {
    geometry = factory();
    geometryPool.set(key, geometry);
  }
  return geometry;
}

/** Shared materials — one set for the whole scene. */
let materials: {
  block: THREE.MeshStandardMaterial;
  border: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  /** Unlit so icon pads stay true white (not warmed by scene lights). */
  iconFace: THREE.MeshBasicMaterial;
  computePad: THREE.MeshStandardMaterial;
  computeIcon: THREE.MeshStandardMaterial;
  computeRim: THREE.MeshStandardMaterial;
  storagePad: THREE.MeshStandardMaterial;
  storageIcon: THREE.MeshStandardMaterial;
  storageRim: THREE.MeshStandardMaterial;
  databasePad: THREE.MeshStandardMaterial;
  databaseIcon: THREE.MeshStandardMaterial;
  databaseRim: THREE.MeshStandardMaterial;
  integrationPad: THREE.MeshStandardMaterial;
  integrationIcon: THREE.MeshStandardMaterial;
  integrationRim: THREE.MeshStandardMaterial;
  /** Cheap far-LOD silhouettes. */
  blockBasic: THREE.MeshBasicMaterial;
} | null = null;

function rimMaterial(cssColor: string) {
  const color = cssToThreeColor(cssColor);
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.22,
    roughness: 0.35,
    metalness: 0.15,
    flatShading: true,
  });
}

function flatMaterial(cssColor: string, emissive = false) {
  const color = cssToThreeColor(cssColor);
  return new THREE.MeshStandardMaterial({
    color,
    emissive: emissive ? color : undefined,
    emissiveIntensity: emissive ? 0.65 : 0,
    roughness: emissive ? 0.32 : 0.5,
    metalness: 0.04,
    toneMapped: !emissive,
  });
}

export function getBlockMaterials() {
  if (!materials) {
    materials = {
      block: new THREE.MeshStandardMaterial({
        color: cssToThreeColor(SCENE.block),
        roughness: 0.4,
        metalness: 0.04,
        flatShading: true,
      }),
      blockBasic: new THREE.MeshBasicMaterial({
        color: cssToThreeColor(SCENE.block),
      }),
      border: new THREE.MeshStandardMaterial({
        color: cssToThreeColor(SCENE.edge),
        roughness: MATERIAL_ROUGHNESS,
        metalness: 0.85,
      }),
      accent: new THREE.MeshStandardMaterial({
        color: cssToThreeColor(SCENE.edge),
        roughness: MATERIAL_ROUGHNESS,
        metalness: 0.1,
      }),
      iconFace: new THREE.MeshBasicMaterial({
        color: cssToThreeColor(SCENE.iconFace),
        toneMapped: false,
      }),
      computePad: flatMaterial(SCENE.computePad),
      computeIcon: flatMaterial(SCENE.computeIcon, true),
      computeRim: rimMaterial(SCENE.computeIcon),
      storagePad: flatMaterial(SCENE.storagePad),
      storageIcon: flatMaterial(SCENE.storageIcon, true),
      storageRim: rimMaterial(SCENE.storageIcon),
      databasePad: flatMaterial(SCENE.databasePad),
      databaseIcon: flatMaterial(SCENE.databaseIcon, true),
      databaseRim: rimMaterial(SCENE.databaseIcon),
      integrationPad: flatMaterial(SCENE.integrationPad),
      integrationIcon: flatMaterial(SCENE.integrationIcon, true),
      integrationRim: rimMaterial(SCENE.integrationIcon),
    };
  } else {
    materials.block.color.copy(cssToThreeColor(SCENE.block));
    materials.block.roughness = 0.4;
    materials.block.metalness = 0.04;
    materials.block.flatShading = true;
    materials.block.needsUpdate = true;
    materials.blockBasic.color.copy(cssToThreeColor(SCENE.block));
    materials.iconFace.color.copy(cssToThreeColor(SCENE.iconFace));
    const syncPad = (
      mat: THREE.MeshStandardMaterial,
      css: string,
      emissive = false,
    ) => {
      const color = cssToThreeColor(css);
      mat.color.copy(color);
      if (emissive) {
        mat.emissive.copy(color);
        mat.emissiveIntensity = 0.65;
      }
      mat.needsUpdate = true;
    };
    const syncRim = (mat: THREE.MeshStandardMaterial, css: string) => {
      const color = cssToThreeColor(css);
      mat.color.copy(color);
      mat.emissive.copy(color);
      mat.emissiveIntensity = 0.22;
      mat.needsUpdate = true;
    };
    syncPad(materials.computePad, SCENE.computePad);
    syncPad(materials.storagePad, SCENE.storagePad);
    syncPad(materials.databasePad, SCENE.databasePad);
    syncPad(materials.integrationPad, SCENE.integrationPad);
    syncPad(materials.computeIcon, SCENE.computeIcon, true);
    syncPad(materials.storageIcon, SCENE.storageIcon, true);
    syncPad(materials.databaseIcon, SCENE.databaseIcon, true);
    syncPad(materials.integrationIcon, SCENE.integrationIcon, true);
    syncRim(materials.computeRim, SCENE.computeIcon);
    syncRim(materials.storageRim, SCENE.storageIcon);
    syncRim(materials.databaseRim, SCENE.databaseIcon);
    syncRim(materials.integrationRim, SCENE.integrationIcon);
  }
  return materials;
}

export function rimMaterialForCategory(
  category: "compute" | "storage" | "database" | "integration",
) {
  const mats = getBlockMaterials();
  switch (category) {
    case "storage":
      return mats.storageRim;
    case "database":
      return mats.databaseRim;
    case "integration":
      return mats.integrationRim;
    default:
      return mats.computeRim;
  }
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

/**
 * Polygon pedestal with a vertical lower half and a linear upper taper.
 * CylinderGeometry provides stable caps and side topology; its middle side
 * ring is expanded to the bottom radius to delay the taper until half-height.
 */
export function createDelayedTaperCylinderGeometry(
  sides: number,
  bottomRadius: number,
  topRadius: number,
  height: number,
) {
  const geometry = new THREE.CylinderGeometry(
    topRadius,
    bottomRadius,
    height,
    sides,
    2,
    false,
  );
  const positions = geometry.getAttribute("position");
  const middleRadius = (bottomRadius + topRadius) / 2;

  for (let i = 0; i < positions.count; i += 1) {
    const y = positions.getY(i);
    if (Math.abs(y) > 1e-5) continue;
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const radius = Math.hypot(x, z);
    if (radius < 1e-5) continue;
    const scale = bottomRadius / middleRadius;
    positions.setXYZ(i, x * scale, y, z * scale);
  }

  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.translate(0, height / 2, 0);
  return geometry;
}

type FootprintRing = { x: number; z: number };

/** Regular n-gon in XZ, CCW from above, vertex on +Z (matches polygon prisms). */
function polygonRing(sides: number, apothem: number): FootprintRing[] {
  const vertexRadius = apothem / Math.cos(Math.PI / sides);
  const ring: FootprintRing[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = Math.PI / 2 + (i * 2 * Math.PI) / sides;
    ring.push({
      x: Math.cos(angle) * vertexRadius,
      z: Math.sin(angle) * vertexRadius,
    });
  }
  return ring;
}

/** Chamfered rectangle in XZ, CCW from above. */
function chamferRectRing(
  width: number,
  depth: number,
  cornerInset: number,
): FootprintRing[] {
  const hw = width / 2;
  const hd = depth / 2;
  const c = Math.min(cornerInset, hw * 0.45, hd * 0.45);
  // CCW from above starting at (+X, +Z) edge.
  return [
    { x: hw - c, z: hd },
    { x: -hw + c, z: hd },
    { x: -hw, z: hd - c },
    { x: -hw, z: -hd + c },
    { x: -hw + c, z: -hd },
    { x: hw - c, z: -hd },
    { x: hw, z: -hd + c },
    { x: hw, z: hd - c },
  ];
}

function pushTri(
  positions: number[],
  normals: number[],
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  let nx = aby * acz - abz * acy;
  let ny = abz * acx - abx * acz;
  let nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}

/**
 * Solid loft through footprint rings. Each face gets unique verts so edges
 * stay hard and tapers read as flat (linear) planes — not smooth-curved.
 */
function createLoftedPrismGeometry(
  rings: { y: number; points: FootprintRing[] }[],
) {
  const n = rings[0]!.points.length;
  const positions: number[] = [];
  const normals: number[] = [];

  // Side walls between consecutive rings — two tris per edge, unique verts.
  for (let r = 0; r < rings.length - 1; r += 1) {
    const lower = rings[r]!;
    const upper = rings[r + 1]!;
    for (let i = 0; i < n; i += 1) {
      const i1 = (i + 1) % n;
      const a = lower.points[i]!;
      const b = lower.points[i1]!;
      const c = upper.points[i1]!;
      const d = upper.points[i]!;
      // Outward for CCW rings when viewed from above (reverse of a→b→c).
      pushTri(
        positions,
        normals,
        a.x,
        lower.y,
        a.z,
        c.x,
        upper.y,
        c.z,
        b.x,
        lower.y,
        b.z,
      );
      pushTri(
        positions,
        normals,
        a.x,
        lower.y,
        a.z,
        d.x,
        upper.y,
        d.z,
        c.x,
        upper.y,
        c.z,
      );
    }
  }

  // Bottom cap (normal -Y).
  const bottom = rings[0]!;
  const b0 = bottom.points[0]!;
  for (let i = 1; i < n - 1; i += 1) {
    const p1 = bottom.points[i]!;
    const p2 = bottom.points[i + 1]!;
    pushTri(
      positions,
      normals,
      b0.x,
      bottom.y,
      b0.z,
      p2.x,
      bottom.y,
      p2.z,
      p1.x,
      bottom.y,
      p1.z,
    );
  }

  // Top cap (normal +Y).
  const top = rings[rings.length - 1]!;
  const t0 = top.points[0]!;
  for (let i = 1; i < n - 1; i += 1) {
    const p1 = top.points[i]!;
    const p2 = top.points[i + 1]!;
    pushTri(
      positions,
      normals,
      t0.x,
      top.y,
      t0.z,
      p1.x,
      top.y,
      p1.z,
      p2.x,
      top.y,
      p2.z,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

/**
 * Pedestal that stays full-width until `taperStart` of height, then tapers
 * linearly to `topScale` of the bottom footprint.
 */
export function createDelayedTaperPolygonGeometry(
  sides: number,
  apothem: number,
  height: number,
  topScale: number,
  taperStart = 0.5,
) {
  const midY = height * taperStart;
  return createLoftedPrismGeometry([
    { y: 0, points: polygonRing(sides, apothem) },
    { y: midY, points: polygonRing(sides, apothem) },
    { y: height, points: polygonRing(sides, apothem * topScale) },
  ]);
}

/** Chamfered-rect pedestal with delayed inward taper (same profile as above). */
export function createDelayedTaperChamferBoxGeometry(
  width: number,
  depth: number,
  height: number,
  cornerInset: number,
  topScale: number,
  taperStart = 0.5,
) {
  const midY = height * taperStart;
  return createLoftedPrismGeometry([
    { y: 0, points: chamferRectRing(width, depth, cornerInset) },
    { y: midY, points: chamferRectRing(width, depth, cornerInset) },
    {
      y: height,
      points: chamferRectRing(
        width * topScale,
        depth * topScale,
        cornerInset * topScale,
      ),
    },
  ]);
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
