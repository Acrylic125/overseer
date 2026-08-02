"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { useTRPC } from "@/lib/trpc/client";

function ProviderStatusBadge({ namespace }: { namespace: string }) {
  const trpc = useTRPC();
  const { data, isPending, isError } = useQuery(
    trpc.providers.verify.queryOptions(
      { namespace },
      {
        refetchInterval: 60_000,
        retry: 1,
      },
    ),
  );

  if (isPending) {
    return (
      <Badge variant="secondary" className="capitalize">
        Checking
      </Badge>
    );
  }

  if (isError || data?.status === "error") {
    return (
      <Badge variant="destructive" title={data?.message ?? "Unreachable"}>
        Error
      </Badge>
    );
  }

  return <Badge variant="default">Connected</Badge>;
}

export function ProvidersList() {
  const trpc = useTRPC();
  const { data, isPending, isError, error } = useQuery(
    trpc.providers.list.queryOptions(),
  );

  if (isPending) {
    return <p className="text-muted-foreground text-sm">Loading providers…</p>;
  }

  if (isError) {
    return <p className="text-destructive text-sm">{error.message}</p>;
  }

  if (data.length === 0) {
    return (
      <p className="text-muted-foreground max-w-md text-sm">
        No providers configured. Add{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
          PROVIDER_CF_&lt;namespace&gt;_API_KEY
        </code>{" "}
        to your <code className="font-mono text-xs">.env</code>.
      </p>
    );
  }

  return (
    <ul className="flex max-w-lg flex-col gap-3">
      {data.map((provider) => (
        <li
          key={`${provider.provider}-${provider.namespace}`}
          className="border-border bg-card/80 flex items-center justify-between gap-4 rounded-lg border px-4 py-3 backdrop-blur-sm"
        >
          <div className="min-w-0">
            <p className="text-card-foreground truncate font-medium">
              {provider.namespace}
            </p>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {provider.provider}
            </p>
          </div>
          <ProviderStatusBadge namespace={provider.namespace} />
        </li>
      ))}
    </ul>
  );
}
