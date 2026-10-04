import type { ComponentType } from "react";

import {
  InfrastructureCanvas,
  type InfrastructureCanvasProps,
} from "@/components/infrastructure/infrastructure-canvas";

/** Register each visualizer here to make it available in layout settings. */
export const visualizers = [
  { id: "default", label: "Default", component: InfrastructureCanvas },
] as const satisfies readonly {
  id: string;
  label: string;
  component: ComponentType<InfrastructureCanvasProps>;
}[];

export type VisualizerId = (typeof visualizers)[number]["id"];
