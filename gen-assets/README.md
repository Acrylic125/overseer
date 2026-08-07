# gen-assets

Preprocesses SVG icons, platform pads, and silhouette shapes into binary
assets for Three.js.

## Setup

```bash
pnpm install
```

## Build all

```bash
pnpm build
```

Runs `icons`, `platform`, then `shapes`.

## Build icons

```bash
pnpm icons
```

Reads every `*.svg` in `icons/`, extrudes paths into meshes with baked vertex
colors, applies Meshopt (`EXT_meshopt_compression`), and writes:

```
_generated/icons.glb
```

Copy into the UI when the GLB changes:

```bash
cp _generated/icons.glb ../ui/public/icons.glb
```

## Build platform

```bash
pnpm platform
```

Bakes the unit squircle platform (body + border) and the diagonal gradient:

```
_generated/platform.glb
_generated/platform-gradient.png
```

```bash
cp _generated/platform.glb ../ui/public/platform.glb
cp _generated/platform-gradient.png ../ui/public/platform-gradient.png
```

## Build shapes

```bash
pnpm shapes
```

Reads every `*.svg` in `shapes/` (e.g. `cloud.svg`), extrudes onto the XZ
ground plane, applies the same platform gradient map, Meshopt-compresses, and
writes:

```
_generated/shapes.glb
_generated/platform-gradient.png
```

Each SVG becomes one named mesh (filename without `.svg`), longer side = 1,
aspect preserved. Scan references these by basename (`cloud` → Public Internet).

```bash
cp _generated/shapes.glb ../ui/public/shapes.glb
cp _generated/platform-gradient.png ../ui/public/platform-gradient.png
```

When loading GLBs in Three.js, enable Meshopt decoding:

```ts
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
```
