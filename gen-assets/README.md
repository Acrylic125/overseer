# gen-assets

Preprocesses SVG icons into a single binary GLB for Three.js `InstancedMesh`.

## Setup

```bash
pnpm install
```

## Build icons

```bash
pnpm icons
```

Reads every `*.svg` in `icons/`, extrudes paths into meshes with baked vertex
colors, applies Meshopt (`EXT_meshopt_compression`), and writes:

```
_generated/icons.glb
```

Each SVG becomes one named mesh (filename without `.svg`), one merged geometry,
centered at the origin. Parsing and tessellation happen only at build time.

When loading in Three.js, enable Meshopt decoding:

```ts
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
```
