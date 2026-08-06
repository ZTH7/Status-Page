import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PublicMonitor } from "../../shared/api-types";

export interface MonitorSearchState {
  query: string;
  setQuery(query: string): void;
  clear(): void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  filteredMonitors: PublicMonitor[];
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  );
}

export function useMonitorSearch(monitors: PublicMonitor[]): MonitorSearchState {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const clear = useCallback(() => setQuery(""), []);

  const filteredMonitors = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return monitors;
    return monitors.filter((monitor) => monitor.name.toLocaleLowerCase().includes(normalizedQuery));
  }, [monitors, query]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && document.activeElement === inputRef.current) {
        event.preventDefault();
        clear();
        inputRef.current?.blur();
        return;
      }

      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [clear]);

  return { query, setQuery, clear, inputRef, filteredMonitors };
}
