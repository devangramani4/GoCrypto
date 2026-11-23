import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Re-render on an interval (relative timestamps such as "12s ago"). */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export type SearchState<K extends string> = Record<K, string>;

/**
 * Filters / tabs / pagination kept in the URL so views are linkable and survive reloads.
 * Values equal to their default are omitted from the query string.
 */
export function useSearchState<K extends string>(defaults: SearchState<K>): [SearchState<K>, (patch: Partial<SearchState<K>>, opts?: { reset?: boolean }) => void] {
  const [params, setParams] = useSearchParams();
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const key = params.toString();
  const state = useMemo(() => {
    const out = {} as SearchState<K>;
    for (const k of Object.keys(defaultsRef.current) as K[]) out[k] = params.get(k) ?? defaultsRef.current[k];
    return out;
    // `key` captures every change of the search params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = useCallback(
    (patch: Partial<SearchState<K>>, opts: { reset?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = opts.reset ? new URLSearchParams() : new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch) as [K, string | undefined][]) {
            if (v === undefined || v === '' || v === defaultsRef.current[k]) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [state, update];
}

/**
 * Run `onOpen` when a dialog transitions from closed to open (form initialisation). Unlike an
 * effect keyed on the source data, a background refetch never wipes what the admin is typing.
 */
export function useOpenEffect(open: boolean, onOpen: () => void): void {
  const fn = useRef(onOpen);
  fn.current = onOpen;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) fn.current();
    wasOpen.current = open;
  }, [open]);
}

/** Parse a positive integer search param with a fallback. */
export function intParam(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
