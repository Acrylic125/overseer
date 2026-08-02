"use client";

import { Bloom, EffectComposer } from "@react-three/postprocessing";

/** Lightweight bloom only — AO/aberration were too expensive for this scene density. */
export function SceneEffects() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom
        luminanceThreshold={0.55}
        luminanceSmoothing={0.4}
        intensity={0.55}
        mipmapBlur
        levels={4}
      />
    </EffectComposer>
  );
}
