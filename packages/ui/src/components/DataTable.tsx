import type { CSSProperties, ReactNode } from 'react';
import { EmptyState, ErrorState, Skeleton, cx } from './primitives';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  width?: number | string;
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  skeletonRows?: number;
  style?: CSSProperties;
  footer?: ReactNode;
}

/** Table with built-in loading skeleton, error and empty states. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  onRowClick,
  skeletonRows = 6,
  style,
  footer,
}: DataTableProps<T>) {
  if (error && !rows?.length) {
    return <ErrorState description={(error as Error)?.message} onRetry={onRetry} />;
  }
  return (
    <div className="gc-table-wrap" style={style}>
      <table className="gc-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cx(c.align === 'right' && 'right', c.className)} style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !rows?.length
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`s${i}`}>
                  {columns.map((c) => (
                    <td key={c.key}>
                      <Skeleton
                        height={12}
                        width={c.align === 'right' ? '60%' : '80%'}
                        style={{ marginLeft: c.align === 'right' ? 'auto' : 0 }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : rows?.map((r) => (
                <tr
                  key={rowKey(r)}
                  className={onRowClick ? 'clickable' : undefined}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cx(c.align === 'right' && 'right', c.className)}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading &&
        rows &&
        rows.length === 0 &&
        (typeof empty === 'string' || empty === undefined ? <EmptyState title={empty ?? 'No data'} /> : empty)}
      {footer}
    </div>
  );
}
