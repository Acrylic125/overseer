"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { InfrastructureService } from "@/server/routers/infrastructure";
import { relatedNodeIds } from "@/lib/graph/trunk-edges";

type SceneContextValue = {
  services: InfrastructureService[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  flyMode: boolean;
  setFlyMode: (value: boolean) => void;
  related: Set<string> | null;
  focusToken: number;
  requestFocus: (id: string) => void;
};

const SceneContext = createContext<SceneContextValue | null>(null);

export function SceneProvider({
  services,
  children,
}: {
  services: InfrastructureService[];
  children: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flyMode, setFlyMode] = useState(false);
  const [focusToken, setFocusToken] = useState(0);

  const related = useMemo(
    () => relatedNodeIds(selectedId, services),
    [selectedId, services],
  );

  useEffect(() => {
    const onClear = () => setSelectedId(null);
    window.addEventListener("overseer:clear-selection", onClear);
    return () => window.removeEventListener("overseer:clear-selection", onClear);
  }, []);

  const value = useMemo(
    () => ({
      services,
      selectedId,
      setSelectedId,
      flyMode,
      setFlyMode,
      related,
      focusToken,
      requestFocus: (id: string) => {
        setSelectedId(id);
        setFocusToken((token) => token + 1);
      },
    }),
    [services, selectedId, flyMode, related, focusToken],
  );

  return (
    <SceneContext.Provider value={value}>{children}</SceneContext.Provider>
  );
}

export function useScene() {
  const ctx = useContext(SceneContext);
  if (!ctx) throw new Error("useScene must be used within SceneProvider");
  return ctx;
}
