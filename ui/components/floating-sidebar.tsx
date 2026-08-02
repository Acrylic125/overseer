"use client";

import { Boxes, Home } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/providers", label: "Providers", icon: Boxes },
] as const;

export function FloatingSidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="border-sidebar-border bg-sidebar/90 text-sidebar-foreground shadow-lg fixed top-1/2 left-4 z-50 flex -translate-y-1/2 flex-col gap-1 rounded-xl border p-1.5 backdrop-blur-md"
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);

        return (
          <Button
            key={href}
            variant={active ? "secondary" : "ghost"}
            size="icon"
            nativeButton={false}
            className={cn(
              "size-9",
              active && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
            render={<Link href={href} aria-label={label} title={label} />}
          >
            <Icon className="size-4" />
          </Button>
        );
      })}
    </nav>
  );
}
