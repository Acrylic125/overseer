"use client";

import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const overlayTabsListClass =
  "bg-black/55 text-white/55 backdrop-blur-sm";
export const overlayTabTriggerClass =
  "px-3 text-white/55 hover:text-white data-active:bg-white/15 data-active:text-white";

export function PageNav({ center }: { center?: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const value = pathname.startsWith("/alerts") ? "alerts" : "view";

  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div className="pointer-events-auto justify-self-start">
        <Tabs
          value={value}
          onValueChange={(next) => {
            if (next === "alerts") {
              router.push("/alerts");
              return;
            }
            if (next === "view") {
              router.push("/");
            }
          }}
        >
          <TabsList className={overlayTabsListClass}>
            <TabsTrigger value="view" className={overlayTabTriggerClass}>
              View
            </TabsTrigger>
            <TabsTrigger value="alerts" className={overlayTabTriggerClass}>
              Alerts
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {center ? (
        <div className="pointer-events-auto justify-self-center">{center}</div>
      ) : (
        <div />
      )}

      {value === "view" ? (
        <div className="pointer-events-auto justify-self-end">
          <Input
            type="search"
            placeholder="Search…"
            aria-label="Search"
            className="h-8 w-48 border-white/10 bg-black/55 text-white placeholder:text-white/55 backdrop-blur-sm focus-visible:border-white/20 focus-visible:ring-white/20"
          />
        </div>
      ) : (
        <div />
      )}
    </div>
  );
}
