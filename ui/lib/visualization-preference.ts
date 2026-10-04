"use client";

import { useSyncExternalStore } from "react";
import type { VisualizationStyle } from "@/lib/data-center";

const key = "overseer.visualizationStyle";
const changeEvent = "overseer:visualization-style";

function snapshot(): VisualizationStyle {
  const style = new URLSearchParams(window.location.search).get("style");
  if (style === "default" || style === "data-center") return style;
  try {
    if (window.localStorage.getItem(key) === "data-center") return "data-center";
  } catch {
    // The URL still works in browsers that disable storage.
  }
  return "default";
}

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("storage", callback);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("storage", callback);
    window.removeEventListener(changeEvent, callback);
  };
}

function setStyle(style: VisualizationStyle) {
  const url = new URL(window.location.href);
  url.searchParams.set("style", style);
  window.history.replaceState(window.history.state, "", url);
  try {
    window.localStorage.setItem(key, style);
  } catch {
    // Retain the URL preference when storage is unavailable.
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function useVisualizationStyle() {
  const style = useSyncExternalStore(subscribe, snapshot, () => "default" as const);
  return [style, setStyle] as const;
}
