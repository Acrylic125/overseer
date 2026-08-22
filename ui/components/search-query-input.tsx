"use client";

import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import type { SearchDocument } from "@/lib/search-ql";
import {
  applySuggestion,
  suggestSearch,
  type SearchSuggestion,
} from "@/lib/search-suggestions";
import { cn } from "@/lib/utils";

type SearchCatalog = {
  docs: SearchDocument[];
};

export function SearchQueryInput({
  catalog,
  value,
  onChange,
  className,
  placeholder,
  "aria-label": ariaLabel,
}: {
  catalog: SearchCatalog;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  "aria-label": string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCursor = useRef<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const suggestions = useMemo(
    () => suggestSearch({ query: value, cursor, catalog }),
    [value, cursor, catalog],
  );

  useLayoutEffect(() => {
    const input = inputRef.current;
    const nextCursor = pendingCursor.current;
    if (input == null || nextCursor == null) {
      return;
    }
    input.setSelectionRange(nextCursor, nextCursor);
    pendingCursor.current = null;
    setCursor(nextCursor);
  }, [value]);

  function syncCursorFromInput() {
    const input = inputRef.current;
    if (input == null) {
      return;
    }
    setCursor(input.selectionStart ?? value.length);
  }

  function accept(suggestion: SearchSuggestion) {
    const applied = applySuggestion(value, suggestion);
    pendingCursor.current = applied.cursor;
    onChange(applied.query);
    setActiveId(null);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (event.key === "Escape") {
        setOpen(false);
      }
      return;
    }

    const currentIndex = suggestions.findIndex((row) => row.id === activeId);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex =
        currentIndex < 0 ? 0 : (currentIndex + 1) % suggestions.length;
      setActiveId(suggestions[nextIndex]?.id ?? null);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex =
        currentIndex <= 0 ? suggestions.length - 1 : currentIndex - 1;
      setActiveId(suggestions[nextIndex]?.id ?? null);
      return;
    }
    if (event.key === "Enter") {
      const selected =
        suggestions.find((row) => row.id === activeId) ?? suggestions[0];
      if (selected != null) {
        event.preventDefault();
        accept(selected);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActiveId(null);
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-expanded={showList}
        aria-controls="search-suggestion-list"
        autoComplete="off"
        className={className}
        onChange={(event) => {
          onChange(event.target.value);
          setCursor(event.target.selectionStart ?? event.target.value.length);
          setOpen(true);
          setActiveId(null);
        }}
        onKeyDown={onKeyDown}
        onClick={syncCursorFromInput}
        onKeyUp={syncCursorFromInput}
        onSelect={syncCursorFromInput}
        onFocus={() => {
          syncCursorFromInput();
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
      />

      {showList ? (
        <div className="absolute top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-white/10 bg-black/90 text-white shadow-lg backdrop-blur-sm">
          <Command shouldFilter={false} className="bg-transparent">
            <CommandList
              id="search-suggestion-list"
              className="max-h-64"
              onMouseDown={(event) => event.preventDefault()}
            >
              <CommandEmpty className="py-3 text-white/55">
                No suggestions
              </CommandEmpty>
              <CommandGroup>
                {suggestions.map((suggestion) => (
                  <CommandItem
                    key={suggestion.id}
                    value={suggestion.id}
                    onSelect={() => accept(suggestion)}
                    className={cn(
                      "text-white data-selected:bg-white/15 data-selected:text-white",
                      suggestion.id === activeId && "bg-white/15",
                    )}
                  >
                    <span className="truncate">{suggestion.label}</span>
                    <span className="ml-auto text-xs text-white/45">
                      {suggestion.kind}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      ) : null}
    </div>
  );
}
