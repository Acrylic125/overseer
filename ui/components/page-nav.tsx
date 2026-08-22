"use client";

import type { ReactNode } from "react";

import { SearchQueryInput } from "@/components/search-query-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SearchDocument } from "@/lib/search-ql";

export const overlayTabsListClass =
  "bg-black/55 text-white/55 backdrop-blur-sm";
export const overlayTabTriggerClass =
  "px-3 text-white/55 hover:text-white data-active:bg-white/15 data-active:text-white";

const searchInputClassName =
  "h-8 w-48 border-white/10 bg-black/55 text-white placeholder:text-white/55 backdrop-blur-sm focus-visible:border-white/20 focus-visible:ring-white/20";

export function PageNav({
  left,
  searchValue,
  onSearchChange,
  searchCatalog,
}: {
  left?: ReactNode;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchCatalog?: { docs: SearchDocument[] };
}) {
  return (
    <div className="pointer-events-none absolute inset-x-4 top-4 z-20 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div className="pointer-events-auto justify-self-start">{left}</div>

      <div className="pointer-events-auto justify-self-center">
        {searchCatalog != null ? (
          <SearchQueryInput
            catalog={searchCatalog}
            value={searchValue}
            onChange={onSearchChange}
            placeholder="Search…"
            aria-label="Search"
            className={searchInputClassName}
          />
        ) : (
          <Input
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search…"
            aria-label="Search"
            className={searchInputClassName}
          />
        )}
      </div>

      <div className="pointer-events-auto justify-self-end">
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="h-8 border-white/10 bg-black/55 px-3 text-white backdrop-blur-sm hover:bg-white/15 hover:text-white"
        >
          Scan
        </Button>
      </div>
    </div>
  );
}
