import { IconButton, Select, Spinner } from '@gocrypto/ui';
import { fmtInt } from '../lib/format';

export const PAGE_SIZES = [25, 50, 100] as const;

export interface PaginationProps {
  page: number;
  pageSize: number;
  /** Total rows when the API reports it; otherwise pass `count` (rows on this page). */
  total?: number;
  count?: number;
  fetching?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

export function Pagination({ page, pageSize, total, count = 0, fetching, onPageChange, onPageSizeChange }: PaginationProps) {
  const offset = (page - 1) * pageSize;
  const shown = total !== undefined ? Math.max(0, Math.min(pageSize, total - offset)) : count;
  const from = shown === 0 ? 0 : offset + 1;
  const to = offset + shown;
  const pages = total !== undefined ? Math.max(1, Math.ceil(total / pageSize)) : undefined;
  const canNext = pages !== undefined ? page < pages : count >= pageSize;
  // Nothing to page through: the table's empty state says it all.
  if (page === 1 && shown === 0) return null;
  return (
    <nav className="adm-pager" aria-label="Pagination">
      <span className="num">
        {total !== undefined ? (
          <>
            {fmtInt(from)}–{fmtInt(to)} of <strong style={{ color: 'var(--c-text)' }}>{fmtInt(total)}</strong>
          </>
        ) : shown > 0 ? (
          `${fmtInt(from)}–${fmtInt(to)}`
        ) : (
          'No rows'
        )}
      </span>
      {fetching && <Spinner size={12} />}
      <span className="spacer" />
      {onPageSizeChange && (
        <>
          <span>Rows per page</span>
          <Select
            size="sm"
            aria-label="Rows per page"
            value={String(pageSize)}
            options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          />
        </>
      )}
      <span className="num">{pages !== undefined ? `Page ${fmtInt(page)} of ${fmtInt(pages)}` : `Page ${fmtInt(page)}`}</span>
      <IconButton icon="chevronLeft" label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
      <IconButton icon="chevronRight" label="Next page" disabled={!canNext} onClick={() => onPageChange(page + 1)} />
    </nav>
  );
}
