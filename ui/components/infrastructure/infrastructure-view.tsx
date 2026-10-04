"use client";

import type { LayoutLens } from "@acrylic125/overseer-sdk/layout";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { InfrastructureCanvas } from "@/components/infrastructure/infrastructure-canvas";
import { PageNav } from "@/components/page-nav";
import { useTRPC } from "@/lib/trpc/client";

export function InfrastructureView() {
  const trpc = useTRPC();
  const [searchQuery, setSearchQuery] = useState("");
  const [lens, setLens] = useState<LayoutLens>("application");
  const { data, isPending, isError, error } = useQuery(
    trpc.infrastructure.list.queryOptions(
      { lens },
      {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 60_000,
        placeholderData: keepPreviousData,
      },
    ),
  );

  if (isPending) {
    return (
      <div className="relative h-svh">
        <PageNav searchValue={searchQuery} onSearchChange={setSearchQuery} />
        <div className="text-muted-foreground flex h-svh items-center justify-center text-sm">
          Loading infrastructure…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="relative h-svh">
        <PageNav searchValue={searchQuery} onSearchChange={setSearchQuery} />
        <div className="text-destructive flex h-svh items-center justify-center px-6 text-center text-sm">
          {error.message}
        </div>
      </div>
    );
  }

  if (data.services.length === 0) {
    return (
      <div className="relative h-svh">
        <PageNav searchValue={searchQuery} onSearchChange={setSearchQuery} />
        <div className="text-muted-foreground flex h-svh flex-col items-center justify-center gap-2 px-6 text-center text-sm">
          <p>No infrastructure found. Run a scan to populate the layout.</p>
        </div>
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
        lens={lens}
        onLensChange={setLens}
        changes={data.changes}
      />
    </div>
  );
}
