"use client";

import { useQuery } from "@tanstack/react-query";

import { InfrastructureCanvas } from "@/components/infrastructure/infrastructure-canvas";
import { useTRPC } from "@/lib/trpc/client";

export function InfrastructureView() {
  const trpc = useTRPC();
  const { data, isPending, isError, error } = useQuery(
    trpc.infrastructure.list.queryOptions(undefined, {
      // Auth lockouts (CF 10502) get worse with automatic retries.
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    }),
  );

  if (isPending) {
    return (
      <div className="text-muted-foreground flex h-svh items-center justify-center text-sm">
        Loading infrastructure…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-destructive flex h-svh items-center justify-center px-6 text-center text-sm">
        {error.message}
      </div>
    );
  }

  if (data.services.length === 0) {
    return (
      <div className="text-muted-foreground flex h-svh flex-col items-center justify-center gap-2 px-6 text-center text-sm">
        <p>No infrastructure found in this Cloudflare account.</p>
        {data.warnings.length > 0 ? (
          <ul className="text-destructive/90 mt-2 max-w-lg list-disc space-y-1 pl-5 text-left text-xs">
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative h-svh w-full overflow-hidden">
      <InfrastructureCanvas
        services={data.services}
        platforms={data.platforms}
        publicInternet={data.publicInternet}
        bounds={data.bounds}
      />
      {data.warnings[0] ? (
        <p className="pointer-events-none absolute top-4 right-4 z-10 max-w-sm rounded-md bg-black/45 px-3 py-2 font-mono text-[11px] text-white/70 backdrop-blur-sm">
          {data.warnings[0]}
        </p>
      ) : null}
    </div>
  );
}
