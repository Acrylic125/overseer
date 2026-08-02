"use client";

import { useEffect, useMemo } from "react";

import { InfrastructureCanvas } from "@/components/infrastructure/infrastructure-canvas";
import { createMockInfrastructure } from "@/lib/mock-infrastructure";

export function InfrastructureView() {
  const data = useMemo(() => createMockInfrastructure(), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Cleared via HudChrome / scene context through custom event
        window.dispatchEvent(new CustomEvent("overseer:clear-selection"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="relative h-svh w-full overflow-hidden">
      <InfrastructureCanvas services={data.services} />
      {data.warnings[0] ? (
        <p className="pointer-events-none absolute top-4 right-4 z-10 max-w-sm rounded-md bg-black/45 px-3 py-2 font-mono text-[11px] text-white/70 backdrop-blur-sm">
          {data.warnings[0]}
        </p>
      ) : null}
    </div>
  );
}
