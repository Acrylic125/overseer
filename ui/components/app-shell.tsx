import { FloatingSidebar } from "@/components/floating-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-dots relative min-h-svh">
      <FloatingSidebar />
      <main className="relative min-h-svh pl-16">{children}</main>
    </div>
  );
}
