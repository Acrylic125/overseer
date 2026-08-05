"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseFieldKey, type FieldType } from "@/lib/infrastructure-schema";
import type { InfrastructureService } from "@/server/routers/infrastructure";

type ServiceDetailSheetProps = {
  service: InfrastructureService | null;
  onOpenChange: (open: boolean) => void;
};

function formatCategoryTitle(name: string) {
  if (!name) return name;
  return name.charAt(0).toUpperCase() + name.slice(1);
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
    <div className="group relative min-w-0">
      <span className="block break-all font-mono text-xs text-foreground">
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
      <div className="flex flex-col gap-1.5 py-2">
        <span className="text-muted-foreground">{name}</span>
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
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="shrink-0 text-muted-foreground">{name}</span>
      <div className="min-w-0">
        {type === "bool" ? (
          <BoolValue value={value as boolean} />
        ) : (
          <ScalarStringValue type={type} value={String(value)} />
        )}
      </div>
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

  const categories = Object.entries(service.fields);

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
        {categories.length === 0 ? (
          <p className="px-4 text-muted-foreground">No details available.</p>
        ) : (
          categories.map(([category, fields]) => (
            <DetailSection
              key={category}
              title={formatCategoryTitle(category)}
            >
              {Object.entries(fields).map(([key, value]) => {
                const { type, name } = parseFieldKey(key);
                return (
                  <FieldRow key={key} type={type} name={name} value={value} />
                );
              })}
            </DetailSection>
          ))
        )}
      </div>
    </aside>
  );
}
