export type MeshSize = {
  width: number;
  height: number;
};

type GltfAccessor = {
  min?: number[];
  max?: number[];
};

type GltfPrimitive = {
  attributes?: { POSITION?: number };
};

type GltfMesh = {
  name?: string;
  primitives?: GltfPrimitive[];
  extras?: {
    footprint?: {
      width?: number;
      height?: number;
    };
  };
};

type GltfNode = {
  name?: string;
  mesh?: number;
};

type GltfJson = {
  accessors?: GltfAccessor[];
  meshes?: GltfMesh[];
  nodes?: GltfNode[];
};

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;

function asBytes(glb: Uint8Array | ArrayBuffer): Uint8Array {
  return glb instanceof Uint8Array ? glb : new Uint8Array(glb);
}

function parseGlbJson(bytes: Uint8Array): GltfJson {
  if (bytes.byteLength < 20) {
    throw new Error("GLB is too small");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("Not a GLB file");
  }

  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== JSON_CHUNK) {
    throw new Error("GLB is missing a JSON chunk");
  }

  const jsonStart = 20;
  const jsonEnd = jsonStart + chunkLength;
  if (jsonEnd > bytes.byteLength) {
    throw new Error("GLB JSON chunk is truncated");
  }

  return JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, jsonEnd))) as GltfJson;
}

function footprintFromMinMax(min: number[], max: number[]): MeshSize | null {
  const dx = Math.abs((max[0] ?? 0) - (min[0] ?? 0));
  const dy = Math.abs((max[1] ?? 0) - (min[1] ?? 0));
  const dz = Math.abs((max[2] ?? 0) - (min[2] ?? 0));
  const [width, height] = [dx, dy, dz].sort((a, b) => b - a);
  if (!width || !height) return null;
  return { width, height };
}

const MAX_ACCESSOR_FOOTPRINT = 1000;

function footprintFromExtras(mesh: GltfMesh): MeshSize | null {
  const footprint = mesh.extras?.footprint;
  if (
    typeof footprint?.width !== "number" ||
    typeof footprint?.height !== "number"
  ) {
    return null;
  }
  if (footprint.width <= 0 || footprint.height <= 0) return null;
  return { width: footprint.width, height: footprint.height };
}

function footprintFromAccessors(
  mesh: GltfMesh,
  accessors: GltfAccessor[],
): MeshSize | null {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const primitive of mesh.primitives ?? []) {
    const accessorIndex = primitive.attributes?.POSITION;
    if (accessorIndex == null) continue;
    const accessor = accessors[accessorIndex];
    const min = accessor?.min;
    const max = accessor?.max;
    if (!min || !max) continue;

    minX = Math.min(minX, min[0] ?? Infinity);
    minY = Math.min(minY, min[1] ?? Infinity);
    minZ = Math.min(minZ, min[2] ?? Infinity);
    maxX = Math.max(maxX, max[0] ?? -Infinity);
    maxY = Math.max(maxY, max[1] ?? -Infinity);
    maxZ = Math.max(maxZ, max[2] ?? -Infinity);
  }

  if (!Number.isFinite(minX)) return null;
  const size = footprintFromMinMax([minX, minY, minZ], [maxX, maxY, maxZ]);
  if (!size) return null;
  if (size.width > MAX_ACCESSOR_FOOTPRINT || size.height > MAX_ACCESSOR_FOOTPRINT) {
    return null;
  }
  return size;
}

function meshFootprint(mesh: GltfMesh, accessors: GltfAccessor[]): MeshSize | null {
  const fromExtras = footprintFromExtras(mesh);
  if (fromExtras) return fromExtras;
  return footprintFromAccessors(mesh, accessors);
}

/** Layout footprints for named meshes in a baked assets GLB. */
export function meshSizesFromGlb(glb: Uint8Array | ArrayBuffer): Map<string, MeshSize> {
  const json = parseGlbJson(asBytes(glb));
  const accessors = json.accessors ?? [];
  const meshes = json.meshes ?? [];
  const sizes = new Map<string, MeshSize>();

  for (const mesh of meshes) {
    const size = meshFootprint(mesh, accessors);
    if (mesh.name && size) sizes.set(mesh.name, size);
  }

  for (const node of json.nodes ?? []) {
    if (!node.name || node.mesh == null || sizes.has(node.name)) continue;
    const mesh = meshes[node.mesh];
    if (!mesh) continue;
    const size = meshFootprint(mesh, accessors);
    if (size) sizes.set(node.name, size);
  }

  return sizes;
}
