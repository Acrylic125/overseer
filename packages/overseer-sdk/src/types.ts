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
    }
  | { type: "hidden" }
  | { type: "secret"; value: string }
  | {
      type: "table";
      columns: string[];
      rows: string[][];
    };

export type FieldGroup =
  | {
      /** When true, the group key is not shown as a section heading. Defaults to false. */
      hideHeading?: boolean;
      type?: "all";
      fields: Record<string, FieldValue | FieldValue[] | FieldGroup>;
    }
  | {
      /** When true, the group key is not shown as a section heading. Defaults to false. */
      hideHeading?: boolean;
      type: "tab-single" | "dropdown-single" | "dropdown-multi";
      fields: Record<string, FieldValue | FieldValue[] | FieldGroup>;
      defaultShow?: string;
    };

export type FieldNode = FieldValue | FieldValue[] | FieldGroup;

export type ResourceFields = Record<string, FieldNode>;

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
  fields: ResourceFields;
  asset: AssetsByProvider;
  alerts: ResourceAlert[];
  tags: Tags<TTag>;
};

export function isFieldGroup(value: FieldNode): value is FieldGroup {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return "fields" in value;
}

/** Object-row tables are easier to write; the wire format stores cells as lists. */
export function table(input: {
  columns: string[];
  rows: Array<Record<string, string>>;
}) {
  const rows: string[][] = [];
  for (const row of input.rows) {
    const cells: string[] = [];
    for (const column of input.columns) {
      cells.push(row[column] ?? "");
    }
    rows.push(cells);
  }
  return {
    type: "table" as const,
    columns: input.columns,
    rows,
  };
}

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

export type ProviderResourceScanner<
  T,
  TScrapeArgs extends unknown[] = [],
  TPolicy = undefined,
> = {
  type: string;
  scrape: (...args: TScrapeArgs) => T[] | Promise<T[]>;
  policy?: TPolicy;
  transform: (item: T, namespace: string, policy?: TPolicy) => Resource | null;
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
      /** `[source→target, target→source]`, aligned to `nodes`. */
      labels: [string, string];
      path: Pos[];
    }
  | { type: "group"; group: string; from: Pos; to: Pos };

export type LayoutOutput = {
  resources: Resource[];
  connections: ResourceConnection[];
  layout: ResourceLayoutItem<string>[];
};
