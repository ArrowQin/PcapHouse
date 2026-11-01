import React, { useEffect, useRef, useState } from 'react';
import { Plus, Check, X } from 'lucide-react';
import { Tag } from '../../types';
import TagBadge from './TagBadge';

interface TagSelectProps {
  value: Tag[];
  allTags: Tag[];
  onChange: (tagIds: number[]) => void | Promise<void>;
}

/**
 * A click-to-edit multi-tag selector. The trigger shows the currently-applied
 * tags; clicking opens a popover to toggle tags on/off. The "Apply" button
 * submits the new selection — cancelling with outside-click discards edits.
 */
const TagSelect: React.FC<TagSelectProps> = ({ value, allTags, onChange }) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>(() => value.map((t) => t.id));
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Reset draft every time the popover opens or the underlying value changes
  useEffect(() => {
    setDraft(value.map((t) => t.id));
  }, [value, open]);

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

  const toggle = (id: number) => {
    setDraft((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const apply = async () => {
    const sortedDraft = [...draft].sort();
    const sortedOriginal = value.map((t) => t.id).sort();
    const changed =
      sortedDraft.length !== sortedOriginal.length ||
      sortedDraft.some((v, i) => v !== sortedOriginal[i]);

    if (!changed) {
      setOpen(false);
      return;
    }

    setBusy(true);
    try {
      await onChange(draft);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      {/* Trigger: current tags + "+ add" */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex flex-wrap items-center gap-1 px-1 py-0.5 rounded hover:bg-dark-600/40 transition-colors disabled:opacity-50"
      >
        {value.length === 0 ? (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-dark hover:text-primary">
            <Plus size={11} />
            Add tag
          </span>
        ) : (
          <>
            {value.slice(0, 3).map((t) => (
              <TagBadge key={t.id} tag={t} size="sm" />
            ))}
            {value.length > 3 && (
              <span className="text-[10px] text-muted-dark">+{value.length - 3}</span>
            )}
            <span className="inline-flex items-center text-muted-dark hover:text-primary ml-0.5">
              <Plus size={10} />
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute z-30 mt-1 left-0 min-w-[220px] rounded-lg bg-dark-700 border border-dark-500 shadow-xl p-1.5">
          <div className="max-h-56 overflow-y-auto">
            {allTags.length === 0 ? (
              <p className="text-xs text-muted-dark text-center py-3 px-2">
                No tags yet. Create some on the Tags page.
              </p>
            ) : (
              allTags.map((tag) => {
                const active = draft.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggle(tag.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                      active
                        ? 'bg-primary/15 text-white'
                        : 'text-muted hover:text-white hover:bg-dark-600'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="flex-1 text-left truncate">{tag.name}</span>
                    {active && <Check size={12} className="text-primary" />}
                  </button>
                );
              })
            )}
          </div>

          {allTags.length > 0 && (
            <div className="flex justify-end gap-1 mt-1 pt-1 border-t border-dark-600">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-2 py-1 rounded text-[11px] text-muted hover:text-white hover:bg-dark-600 transition-colors"
              >
                <X size={11} className="inline" /> Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={busy}
                className="px-2 py-1 rounded text-[11px] bg-primary hover:bg-primary-hover text-white transition-colors disabled:opacity-50"
              >
                <Check size={11} className="inline" /> Apply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TagSelect;
