"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react";

import { PageNav } from "@/components/page-nav";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { useTRPC } from "@/lib/trpc/client";

function AlertList({
  title,
  alerts,
}: {
  title: string;
  alerts: Array<{
    id: string;
    resourceName: string;
    group: string;
    type: "warning" | "error";
    message: string;
  }>;
}) {
  if (alerts.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        {title}
        <span className="ml-1.5 tabular-nums">({alerts.length})</span>
      </h2>
      {alerts.map((alert) => {
        const isError = alert.type === "error";
        return (
          <Alert key={alert.id} variant={isError ? "destructive" : "default"}>
            {isError ? <CircleAlertIcon /> : <TriangleAlertIcon />}
            <AlertTitle>{alert.message}</AlertTitle>
            <AlertDescription>
              {alert.resourceName}
              {alert.group ? ` · ${alert.group}` : ""}
            </AlertDescription>
          </Alert>
        );
      })}
    </section>
  );
}

export function AlertsView() {
  const trpc = useTRPC();
  const { data, isPending, isError, error } = useQuery(
    trpc.infrastructure.alerts.queryOptions(undefined, {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    }),
  );

  if (isPending) {
    return (
      <div className="relative min-h-svh">
        <PageNav />
        <div className="text-muted-foreground flex h-svh items-center justify-center text-sm">
          Loading alerts…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="relative min-h-svh">
        <PageNav />
        <div className="text-destructive flex h-svh items-center justify-center px-6 text-center text-sm">
          {error.message}
        </div>
      </div>
    );
  }

  const errors = data.filter((alert) => alert.type === "error");
  const warnings = data.filter((alert) => alert.type === "warning");
  const empty = errors.length === 0 && warnings.length === 0;

  let summary = "No alerts across scanned resources.";
  if (!empty) {
    const errorLabel = errors.length === 1 ? "error" : "errors";
    const warningLabel = warnings.length === 1 ? "warning" : "warnings";
    summary = `${errors.length} ${errorLabel} · ${warnings.length} ${warningLabel}`;
  }

  return (
    <div className="relative min-h-svh">
      <PageNav />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 pt-20 pb-12">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Alerts</h1>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </header>
        {empty ? null : (
          <div className="flex flex-col gap-8">
            <AlertList title="Errors" alerts={errors} />
            <AlertList title="Warnings" alerts={warnings} />
          </div>
        )}
      </div>
    </div>
  );
}
