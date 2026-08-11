"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import {
  fieldSpan,
  resolveFieldValue,
  type CategoryFields,
  type FieldGraphEdge,
  type ResolvedField,
  type ServiceFields,
} from "@/lib/infrastructure-schema";
import type { InfrastructureService } from "@/server/routers/infrastructure";

type ServiceDetailSheetProps = {
  service: InfrastructureService | null;
  onOpenChange: (open: boolean) => void;
};

const ENV_CATEGORY_PREFIX = "environment:";

type EnvTab = {
  /** Tab value / target slug, e.g. `production`. */
  target: string;
  /** Fields for this deploy target. */
  fields: CategoryFields;
};

function formatCategoryTitle(name: string) {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function formatEnvTabLabel(target: string) {
  const known: Record<string, string> = {
    production: "Production",
    preview: "Preview",
    development: "Development",
    shared: "Shared",
  };
  if (known[target]) return known[target]!;
  return target
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Collect `environment`, `environment:production`, … into ordered tabs.
 * Legacy flat `environment` maps to a Shared tab.
 */
function collectEnvTabs(fields: ServiceFields): EnvTab[] {
  const tabs: EnvTab[] = [];
  const order = ["production", "preview", "development", "shared"];

  for (const [category, categoryFields] of Object.entries(fields)) {
    if (category === "environment" || category === "Environment Variables") {
      tabs.push({ target: "shared", fields: categoryFields });
      continue;
    }
    if (!category.startsWith(ENV_CATEGORY_PREFIX)) continue;
    const target = category.slice(ENV_CATEGORY_PREFIX.length) || "shared";
    tabs.push({ target, fields: categoryFields });
  }

  return tabs.sort((a, b) => {
    const ai = order.indexOf(a.target);
    const bi = order.indexOf(b.target);
    const aRank = ai === -1 ? order.length : ai;
    const bRank = bi === -1 ? order.length : bi;
    if (aRank !== bRank) return aRank - bRank;
    return a.target.localeCompare(b.target);
  });
}

function isEnvironmentCategory(category: string) {
  return (
    category === "environment" ||
    category === "Environment Variables" ||
    category.startsWith(ENV_CATEGORY_PREFIX)
  );
}

function looksLikeLink(value: string) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(value) && !/\s/.test(value))
  );
}

function hrefForLink(value: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `https://${value}`;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="shrink-0"
      onClick={async () => {
        const ok = await copyText(value);
        if (!ok) return;
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function GoButton({ value }: { value: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="shrink-0"
      nativeButton={false}
      render={
        <a
          href={hrefForLink(value)}
          target="_blank"
          rel="noopener noreferrer"
        />
      }
    >
      <ExternalLinkIcon />
      Go
    </Button>
  );
}

function StringActions({ value }: { value: string }) {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 bg-linear-to-l from-background from-65% to-transparent pl-8 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
      {looksLikeLink(value) ? <GoButton value={value} /> : null}
      <CopyButton value={value} />
    </div>
  );
}

function StringValue({ value }: { value: string }) {
  return (
    <div className="group relative min-w-0 w-full">
      <span className="block wrap-break-word break-all whitespace-normal font-mono text-xs text-foreground">
        {value}
      </span>
      <StringActions value={value} />
    </div>
  );
}

function BoolValue({ value }: { value: boolean }) {
  return (
    <Badge variant={value ? "default" : "secondary"}>
      {value ? "Yes" : "No"}
    </Badge>
  );
}

function DateValue({ value }: { value: string }) {
  const parsed = Date.parse(value);
  const label = Number.isFinite(parsed)
    ? new Date(parsed).toLocaleString()
    : value;
  return (
    <span className="font-mono text-xs text-foreground tabular-nums">
      {label}
    </span>
  );
}

type LaidOutNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function layoutGraph(
  vertices: string[],
  edges: FieldGraphEdge[],
): { nodes: LaidOutNode[]; width: number; height: number } {
  const NODE_H = 28;
  const NODE_GAP_Y = 36;
  const NODE_GAP_X = 24;
  const PAD = 16;
  const CHAR_W = 7;
  const MIN_W = 72;

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const id of vertices) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }
  for (const [from, to] of edges) {
    if (!incoming.has(from)) incoming.set(from, []);
    if (!incoming.has(to)) incoming.set(to, []);
    if (!outgoing.has(from)) outgoing.set(from, []);
    if (!outgoing.has(to)) outgoing.set(to, []);
    incoming.get(to)!.push(from);
    outgoing.get(from)!.push(to);
  }

  const depth = new Map<string, number>();
  const queue = vertices.filter((id) => (incoming.get(id)?.length ?? 0) === 0);
  for (const id of queue) depth.set(id, 0);
  const remaining = new Map(
    vertices.map((id) => [id, incoming.get(id)?.length ?? 0]),
  );

  let head = 0;
  while (head < queue.length) {
    const id = queue[head++]!;
    const d = depth.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      const nextDepth = Math.max(depth.get(next) ?? 0, d + 1);
      depth.set(next, nextDepth);
      const left = (remaining.get(next) ?? 1) - 1;
      remaining.set(next, left);
      if (left === 0) queue.push(next);
    }
  }

  for (const id of vertices) {
    if (!depth.has(id)) depth.set(id, 0);
  }

  const layers = new Map<number, string[]>();
  for (const id of vertices) {
    const d = depth.get(id) ?? 0;
    const layer = layers.get(d) ?? [];
    layer.push(id);
    layers.set(d, layer);
  }

  const nodes: LaidOutNode[] = [];
  let maxWidth = 0;
  const maxDepth = Math.max(0, ...depth.values());

  for (let d = 0; d <= maxDepth; d += 1) {
    const layer = layers.get(d) ?? [];
    const widths = layer.map((id) =>
      Math.max(MIN_W, id.length * CHAR_W + 24),
    );
    const totalW =
      widths.reduce((sum, w) => sum + w, 0) +
      Math.max(0, layer.length - 1) * NODE_GAP_X;
    maxWidth = Math.max(maxWidth, totalW);
    let x = 0;
    layer.forEach((id, index) => {
      const width = widths[index]!;
      nodes.push({
        id,
        label: id,
        x,
        y: PAD + d * (NODE_H + NODE_GAP_Y),
        width,
        height: NODE_H,
      });
      x += width + NODE_GAP_X;
    });
  }

  // Center each layer horizontally within the graph bounds.
  for (let d = 0; d <= maxDepth; d += 1) {
    const layerNodes = nodes.filter((node) => (depth.get(node.id) ?? 0) === d);
    if (layerNodes.length === 0) continue;
    const layerWidth =
      layerNodes.reduce((sum, node) => sum + node.width, 0) +
      Math.max(0, layerNodes.length - 1) * NODE_GAP_X;
    let x = PAD + (maxWidth - layerWidth) / 2;
    for (const node of layerNodes) {
      node.x = x;
      x += node.width + NODE_GAP_X;
    }
  }

  return {
    nodes,
    width: maxWidth + PAD * 2,
    height: PAD * 2 + (maxDepth + 1) * NODE_H + maxDepth * NODE_GAP_Y,
  };
}

function GraphValue({
  vertices,
  edges,
}: {
  vertices: string[];
  edges: FieldGraphEdge[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const layout = useMemo(
    () => layoutGraph(vertices, edges),
    [vertices, edges],
  );
  const byId = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Default camera: top-center of the graph.
    const x = el.clientWidth / 2 - layout.width / 2;
    setPan({ x, y: 12 });
  }, [layout.width, vertices, edges]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  if (vertices.length === 0) {
    return <span className="text-muted-foreground">No steps</span>;
  }

  return (
    <div
      ref={containerRef}
      className="h-56 w-full cursor-grab overflow-hidden rounded-md border border-border bg-muted/30 active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg
        width="100%"
        height="100%"
        className="touch-none select-none"
      >
        <g transform={`translate(${pan.x} ${pan.y})`}>
          {edges.map(([from, to], index) => {
            const a = byId.get(from);
            const b = byId.get(to);
            if (!a || !b) return null;
            const x1 = a.x + a.width / 2;
            const y1 = a.y + a.height;
            const x2 = b.x + b.width / 2;
            const y2 = b.y;
            const midY = (y1 + y2) / 2;
            return (
              <path
                key={`${from}-${to}-${index}`}
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                className="stroke-muted-foreground/60"
                strokeWidth={1.5}
              />
            );
          })}
          {layout.nodes.map((node) => (
            <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
              <rect
                width={node.width}
                height={node.height}
                rx={6}
                className="fill-background stroke-border"
                strokeWidth={1}
              />
              <text
                x={node.width / 2}
                y={node.height / 2 + 4}
                textAnchor="middle"
                className="fill-foreground"
                fontSize={11}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {node.label}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

function ScalarValue({ field }: { field: ResolvedField }) {
  switch (field.type) {
    case "bool":
      return <BoolValue value={field.value} />;
    case "date":
      return <DateValue value={field.value} />;
    case "graph":
      return (
        <GraphValue vertices={field.vertices} edges={field.edges} />
      );
    case "string":
      return <StringValue value={field.value} />;
  }
}

function FieldRow({ name, raw }: { name: string; raw: unknown }) {
  const resolved = resolveFieldValue(raw);
  if (!resolved) return null;

  const span = fieldSpan(resolved);
  const items = Array.isArray(resolved) ? resolved : [resolved];

  if (span === 2) {
    return (
      <div className="col-span-2 flex flex-col gap-2 py-2">
        <span className="min-w-0 wrap-break-word whitespace-normal text-muted-foreground">
          {name}
        </span>
        <div className="flex min-w-0 flex-col gap-2">
          {items.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            items.map((item, index) => (
              <ScalarValue key={`${name}-${index}`} field={item} />
            ))
          )}
        </div>
      </div>
    );
  }

  const only = items[0];
  return (
    <>
      <span className="min-w-0 max-w-full wrap-break-word whitespace-normal py-2 text-muted-foreground">
        {name}
      </span>
      <div className="min-w-0 max-w-full py-2">
        {only ? (
          <ScalarValue field={only} />
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </div>
    </>
  );
}

function FieldList({ fields }: { fields: CategoryFields }) {
  return (
    <div className="grid grid-cols-2 gap-x-3">
      {Object.entries(fields).map(([name, value]) => (
        <FieldRow key={name} name={name} raw={value} />
      ))}
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-4">
      <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}

function EnvironmentSection({ tabs }: { tabs: EnvTab[] }) {
  const defaultTab = tabs[0]?.target ?? "shared";
  const [value, setValue] = useState(defaultTab);

  const active = tabs.some((tab) => tab.target === value) ? value : defaultTab;

  return (
    <section className="px-4">
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Environment
      </h3>
      <Tabs
        value={active}
        onValueChange={(next) => {
          if (typeof next === "string") setValue(next);
        }}
        className="flex w-full flex-col gap-3"
      >
        <TabsList className="flex h-9 w-full shrink-0 items-stretch justify-stretch gap-0.5">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.target}
              value={tab.target}
              className="h-auto min-h-0 min-w-0 flex-1 px-2 py-1.5 text-xs"
            >
              {formatEnvTabLabel(tab.target)}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsPanel
            key={tab.target}
            value={tab.target}
            className="w-full outline-none"
          >
            {Object.keys(tab.fields).length === 0 ? (
              <p className="py-2 text-muted-foreground">No variables.</p>
            ) : (
              <FieldList fields={tab.fields} />
            )}
          </TabsPanel>
        ))}
      </Tabs>
    </section>
  );
}

/**
 * Side sheet for the selected service.
 * Rendered as a fixed panel (not Base UI Dialog) so canvas picks don't
 * immediately dismiss it as an outside press.
 */
export function ServiceDetailSheet({
  service,
  onOpenChange,
}: ServiceDetailSheetProps) {
  if (!service) return null;

  return (
    <ServiceDetailSheetBody
      key={service.id}
      service={service}
      onOpenChange={onOpenChange}
    />
  );
}

function ServiceDetailSheetBody({
  service,
  onOpenChange,
}: {
  service: InfrastructureService;
  onOpenChange: (open: boolean) => void;
}) {
  const envTabs = useMemo(
    () => collectEnvTabs(service.fields),
    [service.fields],
  );

  const otherCategories = useMemo(
    () =>
      Object.entries(service.fields).filter(
        ([category]) => !isEnvironmentCategory(category),
      ),
    [service.fields],
  );

  const hasContent = otherCategories.length > 0 || envTabs.length > 0;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="service-detail-title"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-background text-sm text-foreground shadow-lg"
    >
      <header className="relative flex flex-col gap-0.5 border-b border-border p-4 pr-12">
        <h2
          id="service-detail-title"
          className="truncate text-lg font-semibold"
        >
          {service.name}
        </h2>
        <div className="pt-2">
          <Badge variant="secondary">{service.type}</Badge>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-3"
          onClick={() => onOpenChange(false)}
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </Button>
      </header>

      <div className="flex flex-col gap-6 overflow-y-auto py-4">
        {!hasContent ? (
          <p className="px-4 text-muted-foreground">No details available.</p>
        ) : (
          <>
            {envTabs.length > 0 ? <EnvironmentSection tabs={envTabs} /> : null}
            {otherCategories.map(([category, fields]) => (
              <DetailSection
                key={category}
                title={formatCategoryTitle(category)}
              >
                <FieldList fields={fields} />
              </DetailSection>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
