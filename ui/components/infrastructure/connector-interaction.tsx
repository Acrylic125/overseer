"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

import type { ViewMode } from "@/components/infrastructure/infrastructure-camera-sync";
import type { ConnectorFocus } from "@/components/infrastructure/connector-callout";
import type { ConnectorPath } from "@/lib/graph/connector-paths";
import {
  canvasCenterClient,
  pickConnectorAlongRay,
  pickConnectorAt,
  pickableConnectorPaths,
} from "@/lib/graph/pick-connector";
import { pickServiceAt } from "@/lib/graph/pick-service";
import type { InfrastructureService } from "@/server/routers/infrastructure";

function focusFromHit(
  hit: NonNullable<ReturnType<typeof pickConnectorAt>>,
  clientX: number,
  clientY: number,
  paths: ConnectorPath[],
  pinned: boolean,
): ConnectorFocus {
  const path = paths.find((item) => item.id === hit.pathId);
  return {
    pathId: hit.pathId,
    sourceId: hit.sourceId,
    targetId: hit.targetId,
    labels: path?.labels,
    variant: path?.variant,
    clientX,
    clientY,
    worldX: hit.point.x,
    worldZ: hit.point.z,
    pinned,
  };
}

type ConnectorInteractionProps = {
  paths: ConnectorPath[] | null;
  pickPool: InfrastructureService[];
  viewMode: ViewMode;
  selectedServiceId: string | null;
  pinnedFocus: ConnectorFocus | null;
  hoverFocus: ConnectorFocus | null;
  onPinnedFocusChange: (next: ConnectorFocus | null) => void;
  onHoverFocusChange: (next: ConnectorFocus | null) => void;
};

export function ConnectorInteraction({
  paths,
  pickPool,
  viewMode,
  selectedServiceId,
  pinnedFocus,
  hoverFocus,
  onPinnedFocusChange,
  onHoverFocusChange,
}: ConnectorInteractionProps) {
  const { camera, gl } = useThree();
  const pinnedRef = useRef(pinnedFocus);
  const hoverRef = useRef(hoverFocus);
  const pathsRef = useRef(paths);
  const pickPoolRef = useRef(pickPool);
  const viewModeRef = useRef(viewMode);
  const selectedServiceIdRef = useRef(selectedServiceId);
  const onPinnedRef = useRef(onPinnedFocusChange);
  const onHoverRef = useRef(onHoverFocusChange);

  pinnedRef.current = pinnedFocus;
  hoverRef.current = hoverFocus;
  pathsRef.current = paths;
  pickPoolRef.current = pickPool;
  viewModeRef.current = viewMode;
  selectedServiceIdRef.current = selectedServiceId;
  onPinnedRef.current = onPinnedFocusChange;
  onHoverRef.current = onHoverFocusChange;

  useFrame(() => {
    if (viewModeRef.current !== "explore") return;

    const el = gl.domElement;
    const center = canvasCenterClient(el);
    const pickable = pickableConnectorPaths(
      pathsRef.current,
      selectedServiceIdRef.current,
    );

    if (
      pickServiceAt(center.x, center.y, camera, el, pickPoolRef.current) != null
    ) {
      if (hoverRef.current) onHoverRef.current(null);
      return;
    }

    const hit = pickable.length
      ? pickConnectorAlongRay(camera, pickable)
      : null;
    if (!hit) {
      if (hoverRef.current) onHoverRef.current(null);
      return;
    }

    onHoverRef.current(
      focusFromHit(hit, center.x, center.y, pickable, false),
    );
  });

  useEffect(() => {
    if (viewMode !== "top") return;

    const el = gl.domElement;

    const isOverService = (clientX: number, clientY: number) =>
      pickServiceAt(clientX, clientY, camera, el, pickPoolRef.current) != null;

    const hitAt = (clientX: number, clientY: number) => {
      if (isOverService(clientX, clientY)) return null;
      const list = pickableConnectorPaths(
        pathsRef.current,
        selectedServiceIdRef.current,
      );
      if (!list.length) return null;
      return pickConnectorAt(clientX, clientY, camera, el, list);
    };

    const setHover = (clientX: number, clientY: number) => {
      const list = pickableConnectorPaths(
        pathsRef.current,
        selectedServiceIdRef.current,
      );
      const hit = hitAt(clientX, clientY);
      if (!hit) {
        if (hoverRef.current) onHoverRef.current(null);
        return;
      }
      onHoverRef.current(focusFromHit(hit, clientX, clientY, list, false));
    };

    const onPointerMove = (event: PointerEvent) => {
      if (isOverService(event.clientX, event.clientY)) {
        el.style.cursor = "";
        if (hoverRef.current) onHoverRef.current(null);
        return;
      }
      const hit = hitAt(event.clientX, event.clientY);
      el.style.cursor = hit ? "pointer" : "";
      setHover(event.clientX, event.clientY);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;

      const clientX = event.clientX;
      const clientY = event.clientY;

      if (isOverService(clientX, clientY)) {
        if (pinnedRef.current) onPinnedRef.current(null);
        onHoverRef.current(null);
        return;
      }

      const list = pickableConnectorPaths(
        pathsRef.current,
        selectedServiceIdRef.current,
      );
      const hit = hitAt(clientX, clientY);
      if (hit) {
        onHoverRef.current(null);
        onPinnedRef.current(focusFromHit(hit, clientX, clientY, list, true));
        return;
      }
      if (pinnedRef.current) onPinnedRef.current(null);
      onHoverRef.current(null);
    };

    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerdown", onPointerDown);
    return () => {
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerdown", onPointerDown);
      el.style.cursor = "";
    };
  }, [camera, gl, viewMode]);

  useEffect(() => {
    if (viewMode !== "explore") return;

    const el = gl.domElement;

    const hitAtCenter = () => {
      const center = canvasCenterClient(el);
      if (
        pickServiceAt(center.x, center.y, camera, el, pickPoolRef.current) !=
        null
      ) {
        return null;
      }
      const list = pickableConnectorPaths(
        pathsRef.current,
        selectedServiceIdRef.current,
      );
      if (!list.length) return null;
      return pickConnectorAlongRay(camera, list);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;

      const center = canvasCenterClient(el);
      if (
        pickServiceAt(center.x, center.y, camera, el, pickPoolRef.current) !=
        null
      ) {
        if (pinnedRef.current) onPinnedRef.current(null);
        onHoverRef.current(null);
        return;
      }

      const list = pickableConnectorPaths(
        pathsRef.current,
        selectedServiceIdRef.current,
      );
      const hit = hitAtCenter();
      if (hit) {
        onHoverRef.current(null);
        onPinnedRef.current(
          focusFromHit(hit, center.x, center.y, list, true),
        );
        return;
      }
      if (pinnedRef.current) onPinnedRef.current(null);
      onHoverRef.current(null);
    };

    el.addEventListener("pointerdown", onPointerDown);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
    };
  }, [camera, gl, viewMode]);

  return null;
}
