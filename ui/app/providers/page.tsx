import { ProvidersList } from "@/components/providers-list";

export default function ProvidersPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-1">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">
          Providers
        </h1>
        <p className="text-muted-foreground text-sm">
          Connected infrastructure accounts to view your provisioned resources.
        </p>
      </header>
      <ProvidersList />
    </div>
  );
}
