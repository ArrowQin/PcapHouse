import React, { useEffect, useMemo, useState } from 'react';
import { X, Radar, Check, AlertTriangle } from 'lucide-react';
import ProtocolChipEditor from './ProtocolChipEditor';

export interface DetectionItem {
  /** The file id to write the confirmed summary to */
  fileId: number;
  /** Display name for the header */
  fileName: string;
  /** sharkd-detected protocols, comma-separated. May be empty string. */
  suggested: string;
}

interface Props {
  items: DetectionItem[];
  onClose: () => void;
  /** Persist one item's summary. Resolve with true on success. */
  onSave: (fileId: number, summary: string) => Promise<boolean>;
  /** Optional callback after the user finishes (saving or skipping all). */
  onFinished?: () => void;
  /**
   * Lowercased set of protocol short-names the user has opted-in to on the
   * Protocols management page. Detected protocols that appear in this set
   * are *pre-checked*; detected protocols absent from this set are still
   * rendered as chips but left *unchecked* by default. When undefined (still
   * loading, or the feature is disabled), every detected chip is pre-checked.
   */
  enabledCatalog?: Set<string>;
}

/**
 * Queue-style modal that walks the user through each just-uploaded file,
 * shows what sharkd identified, and lets the user click chips to toggle
 * which protocols to keep. The user can also add protocols that sharkd
 * failed to identify via an inline catalog-backed picker.
 *
 * The saved summary is the comma-joined set of currently-selected chips —
 * no manual text editing required (though a free-form textarea still backs
 * the "sharkd returned nothing AND catalog is unreachable" corner case).
 */
const ConfirmProtocolSummaryModal: React.FC<Props> = ({
  items,
  onClose,
  onSave,
  onFinished,
  enabledCatalog,
}) => {
  const [index, setIndex] = useState(0);
  // The superset of chips we render for the current file: detected (from
  // sharkd) + user-added (via the picker). Kept as an ordered array so the
  // detected-first visual layout is preserved.
  const [chips, setChips] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manualDraft, setManualDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const current = items[index];
  const isLast = index === items.length - 1;

  // The unique, ordered list of chips parsed from the sharkd result.
  const detectedChips = useMemo(
    () =>
      Array.from(
        new Set(
          (current?.suggested ?? '')
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        )
      ),
    [current]
  );

  // When moving to a new item, initialise the selection. If the parent has
  // provided the user-curated enabled-set, only those detected protocols that
  // are "opted in" get pre-checked; the others are visible but unchecked so
  // the user can still click them on. Without a catalog (initial load, or
  // sharkd unavailable), default to every detected chip selected — which is
  // the original behaviour.
  useEffect(() => {
    setChips(detectedChips);
    if (enabledCatalog) {
      const initial = detectedChips.filter((p) =>
        enabledCatalog.has(p.toLowerCase())
      );
      setSelected(new Set(initial));
    } else {
      setSelected(new Set(detectedChips));
    }
    setManualDraft('');
  }, [current, detectedChips, enabledCatalog]);

  if (!current) return null;

  const toggleChip = (proto: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(proto)) {
        next.delete(proto);
      } else {
        next.add(proto);
      }
      return next;
    });
  };

  // User added a protocol not present in sharkd's output. Append it to the
  // chip list and auto-select it (that's the whole point of adding).
  const addChip = (proto: string) => {
    setChips((prev) => (prev.includes(proto) ? prev : [...prev, proto]));
    setSelected((prev) => {
      const next = new Set(prev);
      next.add(proto);
      return next;
    });
  };

  const advance = () => {
    if (isLast) {
      onFinished?.();
      onClose();
    } else {
      setIndex((i) => i + 1);
    }
  };

  const buildSummary = (): string => {
    if (chips.length > 0) {
      // Preserve chip order (detected first, then user-added).
      return chips.filter((p) => selected.has(p)).join(', ');
    }
    return manualDraft.trim();
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      await onSave(current.fileId, buildSummary());
      advance();
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = () => {
    advance();
  };

  const handleSkipAll = () => {
    onFinished?.();
    onClose();
  };

  const selectAll = () => setSelected(new Set(chips));
  const clearAll = () => setSelected(new Set());

  // Can't save when the user has unselected everything (and there's no
  // manual-entry fallback applicable) — saving an empty summary would be
  // equivalent to Skip, so we hint at that by disabling the button.
  const saveDisabled =
    busy ||
    (chips.length > 0 && selected.size === 0) ||
    (chips.length === 0 && manualDraft.trim().length === 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        className="bg-dark-700 rounded-xl border border-dark-600 p-6 w-[560px] max-h-[85vh] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4 flex-shrink-0">
          <div className="min-w-0 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/20 flex-shrink-0">
              <Radar size={18} className="text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-white">
                Confirm Protocol Detection
              </h3>
              <p className="text-xs text-muted truncate mt-0.5" title={current.fileName}>
                {current.fileName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded text-muted hover:text-white transition-colors flex-shrink-0 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Progress indicator */}
        {items.length > 1 && (
          <div className="mb-3 text-[11px] text-muted-dark flex-shrink-0">
            File {index + 1} of {items.length}
          </div>
        )}

        {/* Body */}
        <div className="space-y-4 overflow-y-auto pr-1">
          {chips.length > 0 || detectedChips.length > 0 ? (
            <div>
              <label className="block text-xs font-medium text-muted mb-1.5">
                Detected protocols{' '}
                <span className="text-muted-dark">
                  (click to toggle, "Add" for anything sharkd missed)
                </span>
              </label>
              <ProtocolChipEditor
                detected={chips}
                selected={selected}
                onToggle={toggleChip}
                onAdd={addChip}
                disabled={busy}
                showBulkControls
                onSelectAll={selectAll}
                onClearAll={clearAll}
              />
              <p className="text-[10px] text-muted-dark mt-1.5">
                {selected.size > 0
                  ? `Will save: ${chips.filter((p) => selected.has(p)).join(', ')}`
                  : 'Nothing selected — use Skip if you want to save no summary.'}
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium mb-0.5">No protocols detected</p>
                <p className="text-amber-300/80">
                  sharkd did not return any protocol information for this file.
                  You can add protocols manually using the picker above, type a
                  free-form note below, or skip.
                </p>
                <textarea
                  value={manualDraft}
                  onChange={(e) => setManualDraft(e.target.value)}
                  rows={2}
                  placeholder="(optional) Manually type a summary and click Save"
                  className="w-full mt-2 px-3 py-2 rounded-lg bg-dark-600 border border-dark-500 text-sm text-white placeholder:text-muted-dark focus:border-primary focus:outline-none transition-colors resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center gap-3 mt-5 flex-shrink-0">
          <button
            onClick={handleSkipAll}
            disabled={busy}
            className="text-xs text-muted-dark hover:text-white transition-colors disabled:opacity-50"
          >
            Skip all
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleSkip}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm text-muted hover:text-white hover:bg-dark-600 transition-colors disabled:opacity-50"
            >
              Skip
            </button>
            <button
              onClick={handleSave}
              disabled={saveDisabled}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check size={14} />
              {busy ? 'Saving…' : isLast ? 'Save & Finish' : 'Save & Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmProtocolSummaryModal;
