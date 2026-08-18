import { z } from "zod";

import {
  fieldValueSchema,
  type CategoryFields,
  type Connector,
  type Group,
  type InfrastructureDb,
  type Pos,
  type Resource,
  type Size,
} from "@/lib/infrastructure-schema";
import { INTERNET_ID } from "@/lib/internet";

const scanFieldValueSchema = z.union([
  fieldValueSchema,
  z.number(),
  z.array(z.string()),
]);

const scanResourceSchema = z.object({
  id: z.string().min(1),
  group: z.string().min(1),
  name: z.string().min(1),
  url: z.string().optional(),
  service: z.string().min(1),
  asset: z.string().min(1),
  fields: z.record(z.string(), scanFieldValueSchema).default({}),
  alerts: z.array(z.unknown()).optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

const scanConnectionSchema = z.object({
  nodes: z.tuple([z.string().min(1), z.string().min(1)]),
  labels: z.tuple([z.string(), z.string()]),
  type: z.literal("error").optional(),
});

const layoutItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("resource"),
    ref: z.string().min(1),
    pos: z.tuple([z.number(), z.number(), z.number()]),
  }),
  z.object({
    type: z.literal("connector"),
    nodes: z.tuple([z.string().min(1), z.string().min(1)]),
    path: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2),
  }),
  z.object({
    type: z.literal("group"),
    group: z.string().min(1),
    from: z.tuple([z.number(), z.number(), z.number()]),
    to: z.tuple([z.number(), z.number(), z.number()]),
  }),
]);

export const layoutOutputSchema = z.object({
  resources: z.array(scanResourceSchema),
  connections: z.array(scanConnectionSchema),
  layout: z.array(layoutItemSchema),
});

export type LayoutOutputWire = z.infer<typeof layoutOutputSchema>;

const SDK_INTERNET_ID = "internet:public";
const PUBLIC_INTERNET_LAYOUT_GROUP = "__public_internet__";

function normalizeServiceId(id: string) {
  if (id === SDK_INTERNET_ID) return INTERNET_ID;
  return id;
}

function normalizeFields(
  fields: Record<string, z.infer<typeof scanFieldValueSchema>>,
): Record<string, CategoryFields> {
  if (Object.keys(fields).length === 0) return {};
  return { details: fields as CategoryFields };
}

function sourceTypeFromId(id: string, service: string) {
  const prefix = id.split(":")[0];
  if (prefix && prefix !== id) return prefix;
  return service;
}

function connectionKey(nodes: [string, string]) {
  const a = normalizeServiceId(nodes[0]);
  const b = normalizeServiceId(nodes[1]);
  return a <= b ? `${a}\0${b}` : `${b}\0${a}`;
}

function labelsForConnection(
  nodes: [string, string],
  connections: LayoutOutputWire["connections"],
): [string | null, string | null] | undefined {
  const key = connectionKey(nodes);
  for (const connection of connections) {
    if (connectionKey(connection.nodes) !== key) continue;
    return [
      connection.labels[0] ? connection.labels[0] : null,
      connection.labels[1] ? connection.labels[1] : null,
    ];
  }
  return undefined;
}

function connectionVariant(
  nodes: [string, string],
  connections: LayoutOutputWire["connections"],
) {
  const key = connectionKey(nodes);
  for (const connection of connections) {
    if (connectionKey(connection.nodes) !== key) continue;
    if (connection.type === "error") return "warning" as const;
  }
  return undefined;
}

function groupFromBounds(group: string, from: Pos, to: Pos): Group {
  const width = Math.max(to[0] - from[0], 1);
  const depth = Math.max(to[1] - from[1], 1);
  return {
    group,
    pos: [from[0], from[1], from[2]],
    size: [width, depth] satisfies Size,
  };
}

/** Convert SDK scan output (`resources` + `connections` + `layout`) into UI db shape. */
export function layoutOutputToDb(output: LayoutOutputWire): InfrastructureDb {
  const resourcesById = new Map(
    output.resources.map((resource) => [resource.id, resource]),
  );
  const resourcePos = new Map<string, Pos>();
  const groupItems: Array<
    z.infer<typeof layoutItemSchema> & { type: "group" }
  > = [];
  const connectorItems: Array<
    z.infer<typeof layoutItemSchema> & { type: "connector" }
  > = [];

  for (const item of output.layout) {
    if (item.type === "resource") {
      resourcePos.set(item.ref, item.pos);
      continue;
    }
    if (item.type === "group") {
      groupItems.push(item);
      continue;
    }
    connectorItems.push(item);
  }

  const groups: Group[] = groupItems
    .filter((item) => item.group !== PUBLIC_INTERNET_LAYOUT_GROUP)
    .map((item) => groupFromBounds(item.group, item.from, item.to));

  const publicInternetGroup = groupItems.find(
    (item) => item.group === PUBLIC_INTERNET_LAYOUT_GROUP,
  );
  const publicInternet = {
    id: INTERNET_ID as "internet",
    pos: publicInternetGroup
      ? ([
          publicInternetGroup.from[0],
          publicInternetGroup.from[1],
          publicInternetGroup.from[2],
        ] as Pos)
      : ([0, 0, 0] as Pos),
    size: publicInternetGroup
      ? ([
          Math.max(publicInternetGroup.to[0] - publicInternetGroup.from[0], 1),
          Math.max(publicInternetGroup.to[1] - publicInternetGroup.from[1], 1),
        ] as Size)
      : ([4, 2] as Size),
  };

  const resources: Resource[] = [];
  for (const resource of output.resources) {
    if (resource.id === SDK_INTERNET_ID) continue;

    const pos = resourcePos.get(resource.id);
    if (!pos) continue;

    resources.push({
      id: normalizeServiceId(resource.id),
      group: resource.group,
      name: resource.name,
      sourceType: sourceTypeFromId(resource.id, resource.service),
      service: resource.asset,
      fields: normalizeFields(resource.fields),
      pos: [pos[0], pos[1], 0],
    });
  }

  const connectors: Connector[] = connectorItems.map((item) => {
    const nodes: [string, string] = [
      normalizeServiceId(item.nodes[0]),
      normalizeServiceId(item.nodes[1]),
    ];
    const labels = labelsForConnection(item.nodes, output.connections);
    const variant = connectionVariant(item.nodes, output.connections);

    return {
      nodes,
      ...(labels ? { labels } : {}),
      ...(variant ? { variant } : {}),
      path: item.path,
    };
  });

  return {
    resources,
    groups,
    static: { publicInternet },
    connectors,
  };
}
