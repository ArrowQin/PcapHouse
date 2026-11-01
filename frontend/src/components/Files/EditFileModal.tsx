import React, { useEffect, useMemo, useState } from 'react';
import { X, FolderTree, Check, Radar, StickyNote, FileText } from 'lucide-react';
import { Category, PcapFile, Tag } from '../../types';
import TagBadge from '../common/TagBadge';
import ProtocolChipEditor from './ProtocolChipEditor';

interface EditFileModalProps {
  file: PcapFile;
  categories: Category[];
  allTags: Tag[];
  onClose: () => void;
  /**
   * Persist the edits. `protocolSummary === null` means "not changed"; any
   * string (including the empty string, meaning "clear the summary") is
   * treated as an explicit user edit. Same convention for `note`: `null`
   * = unchanged, string = explicit write (empty clears). Same for `name`.
   */
  onSave: (
    fileId: number,
    categoryId: number | null,
    tagIds: number[],
    protocolSummary: string | null,
    note: string | null,
    name: string | null
  ) => Promise<void>;
}

/**
 * Modal that lets the user edit a file's category, tags and protocol
 * summary in one place. Replaces the former inline edit affordances in
 * the Category/Tags columns.
 */
const EditFileModal: React.FC<EditFileModalProps> = ({
  file,
  categories,
  allTags,
  onClose,
  onSave,
}) => {
  const [categoryId, setCategoryId] = useState<number | null>(file.category_id);
  const [tagIds, setTagIds] = useState<number[]>(file.tags.map((t) => t.id));
  const [fileName, setFileName] = useState<string>(file.name);

  // Parse the persisted comma-separated summary into individual chips. We
  // keep the chip list and the "selected" set separate so unchecking a chip
  // doesn't remove it from the UI — the user can toggle it back on without
  // having to retype.
  const initialChips = useMemo(
    () =>
      Array.from(
        new Set(
          (file.protocol_summary || '')
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        )
      ),
    [file.protocol_summary]
  );
  const [chips, setChips] = useState<string[]>(initialChips);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialChips)
  );
  const [note, setNote] = useState<string>(file.note ?? '');
  const [busy, setBusy] = useState(false);

  // Sync state if the modal is re-used for a different file (same component
  // instance, new `file` prop).
  useEffect(() => {
    setCategoryId(file.category_id);
    setTagIds(file.tags.map((t) => t.id));
    setFileName(file.name);
    setChips(initialChips);
    setSelected(new Set(initialChips));
    setNote(file.note ?? '');
  }, [file, initialChips]);

  const toggleTag = (id: number) => {
    setTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleChip = (proto: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(proto)) next.delete(proto);
      else next.add(proto);
      return next;
    });
  };

  const addChip = (proto: string) => {
    setChips((prev) => (prev.includes(proto) ? prev : [...prev, proto]));
    setSelected((prev) => {
      const next = new Set(prev);
      next.add(proto);
      return next;
    });
  };

  // The summary we'd save if the user hit Save right now. Chip order is
  // preserved (stored first, user-added last).
  const nextSummary = useMemo(
    () => chips.filter((p) => selected.has(p)).join(', '),
    [chips, selected]
  );

  const summaryChanged =
    nextSummary !== (file.protocol_summary || '').trim().replace(/\s*,\s*/g, ', ');

  const handleSave = async () => {
    setBusy(true);
    try {
      const originalNote = file.note ?? '';
      const noteChanged = note !== originalNote;
      const nameChanged = fileName.trim() !== file.name;
      await onSave(
        file.id,
        categoryId,
        tagIds,
        summaryChanged ? nextSummary : null,
        noteChanged ? note : null,
        nameChanged ? fileName.trim() : null
      );
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-dark-700 rounded-xl border border-dark-600 p-6 w-[520px] max-h-[85vh] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-white">Edit File</h3>
            <p className="text-xs text-muted truncate mt-0.5" title={file.name}>
              {file.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted hover:text-white transition-colors flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto pr-1">
          {/* File Name */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted mb-1.5">
              <FileText size={12} className="text-muted-dark" />
              File Name
            </label>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="Enter file name…"
              className="w-full px-2.5 py-2 rounded-lg bg-dark-600 border border-dark-500 text-sm text-white placeholder:text-muted-dark hover:border-dark-400 focus:border-primary focus:outline-none transition-colors"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">
              Category
            </label>
            <div className="max-h-48 overflow-y-auto rounded-lg bg-dark-600 border border-dark-500 p-1.5">
              <button
                type="button"
                onClick={() => setCategoryId(null)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                  categoryId === null
                    ? 'bg-primary/15 text-white'
                    : 'text-muted hover:text-white hover:bg-dark-500'
                }`}
              >
                <X size={12} className="text-muted-dark" />
                <span className="flex-1 text-left">Uncategorized</span>
                {categoryId === null && <Check size={12} className="text-primary" />}
              </button>
              {categories.length > 0 && <div className="h-px bg-dark-500 my-1" />}
              {categories.map((c) => {
                const active = c.id === categoryId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategoryId(c.id)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                      active
                        ? 'bg-primary/15 text-white'
                        : 'text-muted hover:text-white hover:bg-dark-500'
                    }`}
                  >
                    <FolderTree
                      size={12}
                      className={active ? 'text-primary' : 'text-muted-dark'}
                    />
                    <span className="flex-1 text-left truncate">{c.name}</span>
                    {active && <Check size={12} className="text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1.5">
              Tags
            </label>
            {allTags.length === 0 ? (
              <p className="text-xs text-muted-dark py-3 px-2 bg-dark-600 rounded-lg border border-dark-500">
                No tags yet. Create some on the Tags page.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto rounded-lg bg-dark-600 border border-dark-500 p-2">
                {allTags.map((tag) => {
                  const active = tagIds.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={`transition-all ${active ? 'opacity-100' : 'opacity-45 hover:opacity-80'}`}
                    >
                      <TagBadge tag={tag} size="sm" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Protocols */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted mb-1.5">
              <Radar size={12} className="text-muted-dark" />
              Protocols
              <span className="text-muted-dark font-normal">
                (click to exclude, "Add" to include more)
              </span>
            </label>
            <ProtocolChipEditor
              detected={chips}
              selected={selected}
              onToggle={toggleChip}
              onAdd={addChip}
              disabled={busy}
            />
            <p className="text-[10px] text-muted-dark mt-1.5">
              {nextSummary
                ? `Will save: ${nextSummary}`
                : 'Summary will be cleared.'}
            </p>
          </div>

          {/* Note */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted mb-1.5">
              <StickyNote size={12} className="text-muted-dark" />
              Note
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note for this file…"
              rows={3}
              className="w-full px-2.5 py-2 rounded-lg bg-dark-600 border border-dark-500 text-xs text-white placeholder:text-muted-dark hover:border-dark-400 focus:border-primary focus:outline-none transition-colors resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-muted hover:text-white hover:bg-dark-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditFileModal;
