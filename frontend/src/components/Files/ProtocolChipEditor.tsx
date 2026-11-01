import React, { useMemo, useRef, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { useProtocolCatalog } from '../../hooks/useProtocolCatalog';

interface Props {
  /** Chips that came from sharkd (or the saved summary). Rendered first. */
  detected: string[];
  /**
   * Currently-selected protocols. Chips not in this set are rendered with a
   * line-through and muted colour so the user can still toggle them back on.
   */
  selected: Set<string>;
  /** Toggle a chip on/off. */
  onToggle: (name: string) => void;
  /**
   * Add a brand-new protocol (not present in `detected`). Implementations
   * should also mark it selected. The parent is responsible for rendering
   * it — typically by appending to `detected`.
   */
  onAdd: (name: string) => void;
  /** Disable all interactions (e.g. while saving). */
  disabled?: boolean;
  /**
   * Optional "Select all / Clear" helper row. Kept optional because the
   * EditFileModal doesn't need it (the saved summary is small).
   */
  showBulkControls?: boolean;
  onSelectAll?: () => void;
  onClearAll?: () => void;
}

/**
 * Reusable chip-picker for protocols, shared by the upload-confirmation
 * modal and the file-edit modal.
 *
 * Rendering contract:
 *   - Every entry in `detected` becomes a clickable chip; selected state is
 *     purely driven by membership in `selected`.
 *   - Below the chips we expose an "Add protocol" affordance: a search box
 *     over the full catalog (fetched once per session, see useProtocolCatalog),
 *     plus a free-text fallback for cases where the backend catalog is
 *     empty/unreachable so the user can still type arbitrary names.
 */
const ProtocolChipEditor: React.FC<Props> = ({
  detected,
  selected,
  onToggle,
  onAdd,
  disabled,
  showBulkControls,
  onSelectAll,
  onClearAll,
}) => {
  const catalog = useProtocolCatalog();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Existing chips shouldn't show up in the picker — the user can just
  // click them directly to toggle. Compare case-insensitively.
  const existingLower = useMemo(
    () => new Set(detected.map((d) => d.toLowerCase())),
    [detected]
  );

  const trimmedQuery = query.trim().toLowerCase();

  // Filter + cap suggestions so we never render a 3000-row list. Exact match
  // (if any) is promoted to the top so Enter-to-add always feels right.
  const suggestions = useMemo(() => {
    if (!catalog) return [];
    const q = trimmedQuery;
    const filtered = catalog.filter(
      (name) => !existingLower.has(name) && (q === '' || name.includes(q))
    );
    if (q) {
      filtered.sort((a, b) => {
        const aStarts = a.startsWith(q) ? 0 : 1;
        const bStarts = b.startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return a.localeCompare(b);
      });
    }
    return filtered.slice(0, 50);
  }, [catalog, trimmedQuery, existingLower]);

  const openPicker = () => {
    if (disabled) return;
    setPickerOpen(true);
    setQuery('');
    // Focus on the next tick so the input is mounted.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleAdd = (name: string) => {
    const normalised = name.trim().toLowerCase();
    if (!normalised) return;
    if (existingLower.has(normalised)) {
      // Already a chip — just make sure it's selected.
      if (!selected.has(normalised) && !selected.has(name)) {
        onToggle(normalised);
      }
      setPickerOpen(false);
      setQuery('');
      return;
    }
    onAdd(normalised);
    setPickerOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Prefer the first suggestion; otherwise treat the typed value as-is
      // (supports custom names even when the backend catalog is unavailable).
      const pick = suggestions[0] ?? trimmedQuery;
      if (pick) handleAdd(pick);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setPickerOpen(false);
      setQuery('');
    }
  };

  return (
    <div>
      {/* Header row: label + optional bulk controls */}
      {showBulkControls && (
        <div className="flex items-center justify-end mb-1.5 gap-2 text-[10px]">
          <button
            type="button"
            onClick={onSelectAll}
            disabled={disabled}
            className="text-muted-dark hover:text-white transition-colors disabled:opacity-50"
          >
            All
          </button>
          <span className="text-muted-dark">·</span>
          <button
            type="button"
            onClick={onClearAll}
            disabled={disabled}
            className="text-muted-dark hover:text-white transition-colors disabled:opacity-50"
          >
            None
          </button>
        </div>
      )}

      {/* Chips */}
      <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-dark-600 border border-dark-500 min-h-[40px]">
        {detected.map((p) => {
          const on = selected.has(p) || selected.has(p.toLowerCase());
          return (
            <button
              type="button"
              key={p}
              onClick={() => onToggle(p)}
              disabled={disabled}
              className={
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] border transition-colors disabled:opacity-50 ' +
                (on
                  ? 'bg-primary/20 text-primary border-primary/40 hover:bg-primary/30'
                  : 'bg-dark-700 text-muted-dark border-dark-500 hover:text-white hover:border-dark-400 line-through')
              }
              title={on ? 'Click to exclude' : 'Click to include'}
            >
              {on && <Check size={10} />}
              {p}
            </button>
          );
        })}

        {/* "Add protocol" inline trigger — styled as an outlined pill so it
            visually lives on the same row as the chips. */}
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] border border-dashed border-dark-400 text-muted-dark hover:text-white hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50"
          title="Add a protocol that wasn't auto-detected"
        >
          <Plus size={10} />
          Add
        </button>
      </div>

      {/* Picker panel — inline (not a popover) so it plays nicely inside
          other scrollable modal bodies. */}
      {pickerOpen && (
        <div className="mt-2 rounded-lg bg-dark-600 border border-dark-500 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-dark-500">
            <Search size={13} className="text-muted-dark flex-shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                catalog === undefined
                  ? 'Loading catalog…'
                  : catalog.length === 0
                    ? 'Type a protocol name and press Enter'
                    : 'Search protocols (e.g. tcp, tls, http2)…'
              }
              disabled={disabled || catalog === undefined}
              className="flex-1 bg-transparent text-xs text-white placeholder:text-muted-dark focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setPickerOpen(false);
                setQuery('');
              }}
              className="p-0.5 rounded text-muted-dark hover:text-white transition-colors"
              title="Close"
            >
              <X size={12} />
            </button>
          </div>

          <div className="max-h-52 overflow-y-auto">
            {catalog === undefined ? (
              <p className="px-3 py-3 text-[11px] text-muted-dark">
                Loading protocol catalog from server…
              </p>
            ) : suggestions.length === 0 ? (
              // Empty-state differs based on why we have nothing to show.
              trimmedQuery ? (
                <div className="px-3 py-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-dark">
                    No match in catalog.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleAdd(trimmedQuery)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/20 hover:bg-primary/30 text-primary text-[11px] font-medium transition-colors"
                  >
                    <Plus size={10} />
                    Add "{trimmedQuery}"
                  </button>
                </div>
              ) : catalog.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-muted-dark">
                  Catalog unavailable (sharkd/tshark not reachable). You can
                  still type a name and press Enter to add it.
                </p>
              ) : (
                <p className="px-3 py-3 text-[11px] text-muted-dark">
                  Type to search {catalog.length} protocols…
                </p>
              )
            ) : (
              <ul className="py-1">
                {suggestions.map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => handleAdd(name)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted hover:bg-dark-500 hover:text-white transition-colors text-left"
                    >
                      <Plus size={11} className="text-muted-dark" />
                      <span className="flex-1 truncate">{name}</span>
                    </button>
                  </li>
                ))}
                {/* Hint when we capped results. */}
                {catalog &&
                  catalog.filter(
                    (n) =>
                      !existingLower.has(n) &&
                      (trimmedQuery === '' || n.includes(trimmedQuery))
                  ).length > suggestions.length && (
                    <li className="px-3 py-1.5 text-[10px] text-muted-dark">
                      Showing first {suggestions.length}. Refine your search to
                      see more.
                    </li>
                  )}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProtocolChipEditor;
