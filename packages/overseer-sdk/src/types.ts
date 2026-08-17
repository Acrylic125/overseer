/** Asset filenames. Later generated as a string union from a .d.ts. */
export type AssetsByProvider = string;

export type ResourceId<TProviderKey extends string> =
  `${TProviderKey}:${string}`;

export type FieldValue =
  | number
  | boolean
  | string
  | { type: "date"; value: string }
  | {
      type: "graph";
      vertices: string[];
      edges: [string, string][];
    };

export type ResourceAlert = {
  type: "warning" | "error";
  message: string;
};

export type Tags<TTag extends string = "namespace"> = {
  [K in TTag]?: string;
};

export type Resource<
  TProviderKey extends string = string,
  TTag extends string = "namespace",
> = {
  id: ResourceId<TProviderKey>;
  group: string;
  name: string;
  url: string;
  service: string;
  fields: Record<string, FieldValue | FieldValue[]>;
  asset: AssetsByProvider;
  alerts: ResourceAlert[];
  tags: Tags<TTag>;
};

export type ResourceClaims =
  | {
      type: "url";
      value: string;
    }
  | {
      type: "ref";
      value: string;
    };

export type ConnectionRequirement =
  | {
      type: "connected";
      label: string;
      errorMessage?: string;
    }
  | false;

export type ResourceConnectionHandler = {
  claims: ResourceClaims[];
  require: (claim: ResourceClaims) => ConnectionRequirement;
};

export type ProviderResourceScanner<T, TScrapeArgs extends unknown[] = []> = {
  type: string;
  scrape: (...args: TScrapeArgs) => T[] | Promise<T[]>;
  transform: (item: T, namespace: string) => Resource | null;
  connection: (item: T) => ResourceConnectionHandler;
};

export type ResourceConnection = {
  nodes: [string, string];
  labels: [string, string];
  type?: "error";
};

export function normalizeConnectionNodes(
  nodes: [string, string],
): [string, string] {
  if (nodes[0] <= nodes[1]) {
    return nodes;
  }
  return [nodes[1], nodes[0]];
}

export function resourceConnection(
  from: string,
  to: string,
  labelFromTo: string,
  labelToFrom: string,
  type?: "error",
): ResourceConnection {
  const nodes = normalizeConnectionNodes([from, to]);
  const labels: [string, string] =
    nodes[0] === from ? [labelFromTo, labelToFrom] : [labelToFrom, labelFromTo];
  if (type) {
    return { nodes, labels, type };
  }
  return { nodes, labels };
}

export function connectionKey(nodes: [string, string]): string {
  const normalized = normalizeConnectionNodes(nodes);
  return `${normalized[0]}\0${normalized[1]}`;
}

export type Pos = [number, number, number];

export type ResourceLayoutItem<TProviderKeys extends string> =
  | { type: "resource"; ref: ResourceId<TProviderKeys>; pos: Pos }
  | {
      type: "connector";
      nodes: [string, string];
      path: Pos[];
    }
  | { type: "group"; from: Pos; to: Pos };

export type LayoutOutput = {
  resources: Resource[];
  connections: ResourceConnection[];
  layout: ResourceLayoutItem<string>[];
};
