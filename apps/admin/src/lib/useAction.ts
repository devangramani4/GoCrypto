import { useToast } from '@gocrypto/ui';
import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { errorMessage } from './errors';

export interface ActionOptions<TVars, TData> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /** Success toast (string or builder). */
  success?: string | ((data: TData, vars: TVars) => string);
  /** Query key prefixes to invalidate after success. */
  invalidate?: QueryKey[];
  /** Toast failures (dialogs render the error inline instead). Default true. */
  errorToast?: boolean;
  onSuccess?: (data: TData, vars: TVars) => void;
}

/** `useMutation` + success/error toasts + cache invalidation, the standard shape of every admin action. */
export function useAction<TVars = void, TData = unknown>(opts: ActionOptions<TVars, TData>) {
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation<TData, unknown, TVars>({
    mutationFn: opts.mutationFn,
    onSuccess: (data, vars) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(data, vars) : opts.success);
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      opts.onSuccess?.(data, vars);
    },
    onError: (e) => {
      if (opts.errorToast !== false) toast.error('Action failed', errorMessage(e));
    },
  });
}

/** Stable function identity that always calls the latest implementation. */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
