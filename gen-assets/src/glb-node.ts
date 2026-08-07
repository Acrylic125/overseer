import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMaterialsUnlit,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

/** Minimal FileReader so GLTFExporter can build a binary GLB under Node. */
class NodeFileReader {
  result: string | ArrayBuffer | null = null;
  readyState = 0;
  error: DOMException | null = null;
  onloadend:
    | ((this: FileReader, ev: ProgressEvent<FileReader>) => void)
    | null = null;
  onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => void) | null =
    null;

  private finish(
    result: string | ArrayBuffer,
    err: DOMException | null = null,
  ): void {
    this.result = result;
    this.error = err;
    this.readyState = 2;
    const ev = {} as ProgressEvent<FileReader>;
    if (err) this.onerror?.call(this as unknown as FileReader, ev);
    this.onloadend?.call(this as unknown as FileReader, ev);
  }

  readAsArrayBuffer(blob: Blob): void {
    void blob
      .arrayBuffer()
      .then((buffer) => this.finish(buffer))
      .catch((err: unknown) => {
        this.finish(
          new ArrayBuffer(0),
          err instanceof DOMException
            ? err
            : new DOMException(String(err), "NotReadableError"),
        );
      });
  }

  readAsDataURL(blob: Blob): void {
    void blob
      .arrayBuffer()
      .then((buffer) => {
        const base64 = Buffer.from(buffer).toString("base64");
        const type = blob.type || "application/octet-stream";
        this.finish(`data:${type};base64,${base64}`);
      })
      .catch((err: unknown) => {
        this.finish(
          "",
          err instanceof DOMException
            ? err
            : new DOMException(String(err), "NotReadableError"),
        );
      });
  }
}

let installed = false;

/** Install browser shims required by GLTFExporter in Node (idempotent). */
export function ensureGlbNodeShims(): void {
  if (installed) return;
  globalThis.FileReader =
    NodeFileReader as unknown as typeof globalThis.FileReader;
  installed = true;
}

export async function exportSceneGlb(scene: THREE.Scene): Promise<ArrayBuffer> {
  ensureGlbNodeShims();
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: true,
  });

  if (!(result instanceof ArrayBuffer)) {
    throw new Error("GLTFExporter did not return a binary GLB ArrayBuffer");
  }
  return result;
}

/** Reorder + quantize + EXT_meshopt_compression via glTF Transform. */
export async function compressMeshopt(glb: ArrayBuffer): Promise<Uint8Array> {
  await MeshoptEncoder.ready;

  const io = new NodeIO()
    .registerExtensions([
      EXTMeshoptCompression,
      KHRMaterialsUnlit,
      KHRMeshQuantization,
    ])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

  const document = await io.readBinary(new Uint8Array(glb));
  await document.transform(
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  return await io.writeBinary(document);
}
