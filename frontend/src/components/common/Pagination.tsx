import React from 'react';
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';

interface PaginationProps {
  page: number;        // 1-based current page
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

/** Build a compact page list with ellipses — e.g. `1 … 4 5 6 … 20`. */
function buildPageList(current: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: (number | 'gap')[] = [];
  const push = (v: number | 'gap') => {
    if (v !== 'gap' || pages[pages.length - 1] !== 'gap') pages.push(v);
  };

  push(1);
  if (current > 3) push('gap');
  for (let p = Math.max(2, current - 1); p <= Math.min(totalPages - 1, current + 1); p++) {
    push(p);
  }
  if (current < totalPages - 2) push('gap');
  push(totalPages);
  return pages;
}

const Pagination: React.FC<PaginationProps> = ({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [20, 50, 100],
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const firstItem = total === 0 ? 0 : (clampedPage - 1) * pageSize + 1;
  const lastItem = Math.min(total, clampedPage * pageSize);

  // Only show page navigation when there is more than one page. When the
  // list fits on a single page, we still render the bar (for the range
  // summary / page-size selector) unless onPageSizeChange is also absent.
  const showNav = totalPages > 1;

  const pages = buildPageList(clampedPage, totalPages);

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5 border-t border-dark-600 bg-dark-700/30">
      {/* Left: range summary */}
      <div className="flex items-center gap-2 text-xs text-muted-dark">
        <span>
          {firstItem}–{lastItem} of {total}
        </span>
        {onPageSizeChange && (
          <div className="relative">
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
              className="appearance-none px-1.5 pr-5 py-0.5 rounded bg-dark-700 border border-dark-500 text-xs text-muted hover:text-white hover:border-dark-400 focus:border-primary focus:outline-none cursor-pointer transition-colors"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
            <ChevronDown
              size={10}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-dark pointer-events-none"
            />
          </div>
        )}
      </div>

      {/* Right: page controls (hidden when a single page fits all rows) */}
      {showNav && (
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onPageChange(clampedPage - 1)}
            disabled={clampedPage <= 1}
            className="p-1 rounded text-muted hover:text-white hover:bg-dark-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous page"
          >
            <ChevronLeft size={13} />
          </button>

          {pages.map((p, i) =>
            p === 'gap' ? (
              <span
                key={`gap-${i}`}
                className="px-1 text-xs text-muted-dark select-none"
              >
                …
              </span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`min-w-[24px] h-6 px-1.5 rounded text-xs transition-colors ${
                  p === clampedPage
                    ? 'bg-primary text-white'
                    : 'text-muted hover:text-white hover:bg-dark-600'
                }`}
              >
                {p}
              </button>
            )
          )}

          <button
            onClick={() => onPageChange(clampedPage + 1)}
            disabled={clampedPage >= totalPages}
            className="p-1 rounded text-muted hover:text-white hover:bg-dark-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next page"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
};

export default Pagination;
