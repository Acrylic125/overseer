"use client";

import { useMemo } from "react";

import { InfrastructureCanvas } from "@/components/infrastructure/infrastructure-canvas";
import { createMockInfrastructure } from "@/lib/mock-infrastructure";

export function InfrastructureView() {
  const data = useMemo(() => createMockInfrastructure(), []);

  return (
    <div className="relative h-svh w-full overflow-hidden">
      <InfrastructureCanvas
        services={data.services}
        platforms={data.platforms}
        bounds={data.bounds}
      />
      {data.warnings[0] ? (
        <p className="pointer-events-none absolute top-4 right-4 z-10 max-w-sm rounded-md bg-black/45 px-3 py-2 font-mono text-[11px] text-white/70 backdrop-blur-sm">
          {data.warnings[0]}
        </p>
      ) : null}
    </div>
  );
}
