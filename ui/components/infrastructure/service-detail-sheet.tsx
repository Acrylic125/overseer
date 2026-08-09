"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsPanel, TabsTrigger } from "@/components/ui/tabs";
import {
  parseFieldKey,
  type CategoryFields,
  type FieldType,
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
    if (category === "environment") {
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
    category === "environment" || category.startsWith(ENV_CATEGORY_PREFIX)
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
        <a href={hrefForLink(value)} target="_blank" rel="noopener noreferrer" />
      }
    >
      <ExternalLinkIcon />
      Go
    </Button>
  );
}

function FieldActions({
  type,
  value,
}: {
  type: Exclude<FieldType, "bool">;
  value: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 bg-linear-to-l from-background from-65% to-transparent pl-8 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
      {type === "link" ? <GoButton value={value} /> : null}
      <CopyButton value={value} />
    </div>
  );
}

function ScalarStringValue({
  type,
  value,
}: {
  type: Exclude<FieldType, "bool">;
  value: string;
}) {
  return (
    <div className="group relative min-w-0 w-full">
      <span className="block wrap-break-word break-all whitespace-normal font-mono text-xs text-foreground">
        {value}
      </span>
      <FieldActions type={type} value={value} />
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

function FieldRow({
  type,
  name,
  value,
}: {
  type: FieldType;
  name: string;
  value: string | boolean | string[] | boolean[];
}) {
  const isArray = Array.isArray(value);

  if (isArray) {
    return (
      <div className="grid grid-cols-2 gap-3 py-2">
        <span className="min-w-0 max-w-full wrap-break-word whitespace-normal text-muted-foreground">
          {name}
        </span>
        <div className="min-w-0 max-w-full">
          {value.length === 0 ? (
            <span className="text-muted-foreground">None</span>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {value.map((item, index) => (
                <li key={`${name}-${index}`}>
                  {type === "bool" ? (
                    <BoolValue value={item as boolean} />
                  ) : (
                    <ScalarStringValue
                      type={type}
                      value={String(item)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 py-2">
      <span className="min-w-0 max-w-full wrap-break-word whitespace-normal text-muted-foreground">
        {name}
      </span>
      <div className="min-w-0 max-w-full">
        {type === "bool" ? (
          <BoolValue value={value as boolean} />
        ) : (
          <ScalarStringValue type={type} value={String(value)} />
        )}
      </div>
    </div>
  );
}

function FieldList({ fields }: { fields: CategoryFields }) {
  return (
    <div>
      {Object.entries(fields).map(([key, value]) => {
        const { type, name } = parseFieldKey(key);
        return <FieldRow key={key} type={type} name={name} value={value} />;
      })}
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

  // When the selected service changes, tabs remount via key on the parent.
  const active = tabs.some((tab) => tab.target === value)
    ? value
    : defaultTab;

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
            {envTabs.length > 0 ? (
              <EnvironmentSection tabs={envTabs} />
            ) : null}
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
