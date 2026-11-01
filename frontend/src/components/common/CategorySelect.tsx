import React, { useEffect, useRef, useState } from 'react';
import { FolderTree, ChevronDown, Check, X } from 'lucide-react';
import { Category } from '../../types';

interface CategorySelectProps {
  value: number | null;
  categories: Category[];
  onChange: (categoryId: number | null) => void | Promise<void>;
  /** Compact read-only chip style (for use inside table cells) */
  inline?: boolean;
  /** Category name to show when `value` isn't found in `categories`. */
  fallbackName?: string;
}

/**
 * A small click-to-edit category selector. When `inline` is true the trigger
 * renders as a chip that blends into a table cell; otherwise it renders as a
 * full-width pill button. A popover with the list of categories opens on
 * click; clicking outside closes it without submitting.
 */
const CategorySelect: React.FC<CategorySelectProps> = ({
  value,
  categories,
  onChange,
  inline = false,
  fallbackName,
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = categories.find((c) => c.id === value) ?? null;
  const displayName = current?.name ?? fallbackName ?? null;

  const commit = async (next: number | null) => {
    if (next === value) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await onChange(next);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className={
          inline
            ? displayName
              ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50'
              : 'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs text-muted-dark hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-50'
            : 'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-700 border border-dark-500 text-xs text-white hover:border-dark-400 transition-colors disabled:opacity-50'
        }
        title="Change category"
      >
        <FolderTree size={inline ? 11 : 13} />
        <span className="truncate max-w-[140px]">
          {displayName ?? (inline ? '+ Category' : 'Uncategorized')}
        </span>
        <ChevronDown size={inline ? 10 : 12} className="opacity-70" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 min-w-[180px] max-h-64 overflow-y-auto rounded-lg bg-dark-700 border border-dark-500 shadow-xl p-1.5">
          {/* Clear / Uncategorized option */}
          <button
            type="button"
            onClick={() => commit(null)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
              value === null
                ? 'bg-primary/15 text-white'
                : 'text-muted hover:text-white hover:bg-dark-600'
            }`}
          >
            <X size={12} className="text-muted-dark" />
            <span className="flex-1 text-left">Uncategorized</span>
            {value === null && <Check size={12} className="text-primary" />}
          </button>

          {categories.length > 0 && <div className="h-px bg-dark-600 my-1" />}

          {categories.map((c) => {
            const active = c.id === value;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => commit(c.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                  active
                    ? 'bg-primary/15 text-white'
                    : 'text-muted hover:text-white hover:bg-dark-600'
                }`}
              >
                <FolderTree size={12} className={active ? 'text-primary' : 'text-muted-dark'} />
                <span className="flex-1 text-left truncate">{c.name}</span>
                {active && <Check size={12} className="text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default CategorySelect;
