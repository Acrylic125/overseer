"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";

import type { ConnectorPath } from "@/lib/graph/connector-paths";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import {
  buildServiceSpatialIndex,
  expandWithLinkedServices,
  filterConnectorPaths,
  footprintInWindow,
  quantizeFocus,
  streamServicesInWindow,
  windowAround,
  withInternetHubForConnectors,
  type StreamFocus,
} from "@/lib/graph/service-streaming";
import type { InfrastructureService } from "@/server/routers/infrastructure";

type UseStreamedSceneArgs = {
  services: InfrastructureService[];
  renderServices: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
  publicInternet: PackLayoutResult["publicInternet"];
  connectorPaths: ConnectorPath[] | null;
  selectedServiceId: string | null;
  internetHubService: InfrastructureService | null;
};

export function useStreamedScene({
  services,
  renderServices,
  platforms,
  publicInternet,
  connectorPaths,
  selectedServiceId,
  internetHubService,
}: UseStreamedSceneArgs) {
  const { camera } = useThree();
  const spatialIndex = useMemo(
    () => buildServiceSpatialIndex(renderServices),
    [renderServices],
  );
  const initialFocus = quantizeFocus(camera.position.x, camera.position.z);
  const [focus, setFocus] = useState<StreamFocus>(initialFocus);
  const lastFocusRef = useRef<StreamFocus>(initialFocus);

  useFrame(() => {
    const next = quantizeFocus(camera.position.x, camera.position.z);
    if (
      next.focusX === lastFocusRef.current.focusX &&
      next.focusZ === lastFocusRef.current.focusZ
    ) {
      return;
    }
    lastFocusRef.current = next;
    setFocus(next);
  });

  const streamWindow = useMemo(
    () => windowAround(focus.focusX, focus.focusZ),
    [focus],
  );

  const visibleRenderServices = useMemo(
    () => streamServicesInWindow(spatialIndex, focus.focusX, focus.focusZ),
    [spatialIndex, focus],
  );

  const connectorServices = useMemo(
    () =>
      withInternetHubForConnectors(
        expandWithLinkedServices(
          visibleRenderServices,
          services,
          selectedServiceId,
          internetHubService,
        ),
        internetHubService,
      ),
    [
      visibleRenderServices,
      services,
      selectedServiceId,
      internetHubService,
    ],
  );

  const visiblePlatforms = useMemo(
    () => platforms.filter((platform) => footprintInWindow(platform, streamWindow)),
    [platforms, streamWindow],
  );

  const showPublicInternet = useMemo(
    () =>
      publicInternet.width > 0 &&
      publicInternet.depth > 0 &&
      footprintInWindow(publicInternet, streamWindow),
    [publicInternet, streamWindow],
  );

  const streamedConnectorPaths = useMemo(() => {
    if (connectorPaths == null) return null;
    const allowedIds = new Set(connectorServices.map((service) => service.id));
    return filterConnectorPaths(connectorPaths, allowedIds);
  }, [connectorPaths, connectorServices]);

  return {
    visibleRenderServices,
    connectorServices,
    visiblePlatforms,
    showPublicInternet,
    streamedConnectorPaths,
  };
}
