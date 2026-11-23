import { EmptyState, ErrorState, Skeleton } from '@gocrypto/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { errorMessage } from '../lib/errors';
import { type PermissionRequirement, requirementLabel } from '../lib/permissions';

export function Forbidden({ perm, title = 'You don’t have access to this area' }: { perm?: PermissionRequirement; title?: string }) {
  return (
    <div className="adm-panel">
      <EmptyState
        icon="lock"
        title={title}
        description={
          <>
            {perm ? (
              <>
                Requires permission <code className="adm-mono">{requirementLabel(perm)}</code>.{' '}
              </>
            ) : null}
            Ask a Super Admin to update your role if you need it.
          </>
        }
      />
    </div>
  );
}

/** Generic block skeleton for non-tabular views. */
export function BlockSkeleton({ rows = 4, height = 14 }: { rows?: number; height?: number }) {
  return (
    <div className="adm-stack" style={{ padding: 16 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={height} width={`${92 - ((i * 17) % 40)}%`} />
      ))}
    </div>
  );
}

/** Loading / error / empty handling for non-table query views. */
export function QueryView<T>({
  query,
  skeleton,
  isEmpty,
  empty,
  children,
}: {
  query: UseQueryResult<T>;
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <BlockSkeleton />}</>;
  if (query.isError) return <ErrorState description={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState title="No data" />}</>;
  return <>{children(query.data)}</>;
}

interface BoundaryState {
  error: Error | null;
}

/** Catches render errors inside a page so the shell (navigation) stays usable. */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Admin page crashed', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="adm-panel">
          <ErrorState
            title="This page failed to render"
            description={errorMessage(this.state.error)}
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

export function JsonView({ value }: { value: unknown }) {
  return <pre className="adm-json">{safeStringify(value, 2)}</pre>;
}

export function safeStringify(value: unknown, space?: number): string {
  try {
    return JSON.stringify(value, null, space) ?? 'undefined';
  } catch {
    return String(value);
  }
}
