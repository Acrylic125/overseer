"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { LayoutSettings } from "@/components/infrastructure/layout-settings";
import {
  visualizers,
  type VisualizerId,
} from "@/components/infrastructure/visualizers";
import { PageNav } from "@/components/page-nav";
import { useTRPC } from "@/lib/trpc/client";
import type { GroupingMode } from "@/lib/layout-options";

export function InfrastructureView() {
  const [grouping, setGrouping] = useState<GroupingMode>("scanned");
  const [visualizer, setVisualizer] = useState<VisualizerId>("default");
  const Visualizer = (
    visualizers.find(({ id }) => id === visualizer) ?? visualizers[0]
  ).component;
  const settings = (
    <LayoutSettings
      grouping={grouping}
      onGroupingChange={setGrouping}
      visualizer={visualizer}
      onVisualizerChange={setVisualizer}
    />
  );
  const trpc = useTRPC();
  const { data, isPending, isError, error } = useQuery(
    trpc.infrastructure.list.queryOptions(
      { grouping },
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
        <PageNav searchValue="" onSearchChange={() => {}} right={settings} />
        <div className="text-muted-foreground flex h-svh items-center justify-center text-sm">
          Loading infrastructure…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="relative h-svh">
        <PageNav searchValue="" onSearchChange={() => {}} right={settings} />
        <div className="text-destructive flex h-svh items-center justify-center px-6 text-center text-sm">
          {error.message}
        </div>
      </div>
    );
  }

  if (data.services.length === 0) {
    return (
      <div className="relative h-svh">
        <PageNav searchValue="" onSearchChange={() => {}} right={settings} />
        <div className="text-muted-foreground flex h-svh flex-col items-center justify-center gap-2 px-6 text-center text-sm">
          <p>No infrastructure found. Run a scan to populate the layout.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-svh w-full overflow-hidden">
      <Visualizer
        key={`${visualizer}:${data.grouping}`}
        services={data.services}
        platforms={data.platforms}
        publicInternet={data.publicInternet}
        bounds={data.bounds}
        connectorPaths={data.connectorPaths}
        cameraFrame={data.camera}
        settings={settings}
      />
    </div>
  );
}
