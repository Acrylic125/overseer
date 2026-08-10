"use client";

import { useQuery } from "@tanstack/react-query";

import { InfrastructureCanvas } from "@/components/infrastructure/infrastructure-canvas";
import { useTRPC } from "@/lib/trpc/client";

export function InfrastructureView() {
  const trpc = useTRPC();
  const { data, isPending, isError, error } = useQuery(
    trpc.infrastructure.list.queryOptions(undefined, {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    }),
  );

  if (isPending) {
    return (
      <div className="text-muted-foreground flex h-svh items-center justify-center text-sm">
        Loading infrastructure…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-destructive flex h-svh items-center justify-center px-6 text-center text-sm">
        {error.message}
      </div>
    );
  }

  if (data.services.length === 0) {
    return (
      <div className="text-muted-foreground flex h-svh flex-col items-center justify-center gap-2 px-6 text-center text-sm">
        <p>No infrastructure found. Run a scan to populate the layout.</p>
      </div>
    );
  }

  return (
    <div className="relative h-svh w-full overflow-hidden">
      <InfrastructureCanvas
        services={data.services}
        platforms={data.platforms}
        publicInternet={data.publicInternet}
        bounds={data.bounds}
        connectorPaths={data.connectorPaths}
        cameraFrame={data.camera}
      />
    </div>
  );
}
