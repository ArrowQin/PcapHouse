import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload,
  FileUp,
  X,
  FolderTree,
  Tags as TagsIcon,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  StickyNote,
} from 'lucide-react';
import axios from 'axios';
import { fileApi } from '../../api/files';
import { categoryApi } from '../../api/categories';
import { tagApi } from '../../api/tags';
import { Category, Tag } from '../../types';
import ConfirmProtocolSummaryModal, {
  DetectionItem,
} from './ConfirmProtocolSummaryModal';
import { useEnabledProtocols } from '../../hooks/useEnabledProtocols';

interface UploadZoneProps {
  /** Pre-selected category. When set, the category picker is hidden. */
  categoryId?: number | null;
  onUploadComplete: () => void;
  /** Use a more compact layout suitable for narrow containers (e.g. right panel). */
  compact?: boolean;
}

type QueueStatus = 'pending' | 'uploading' | 'done' | 'error';

interface QueueItem {
  id: string; // client-side id
  file: File;
  status: QueueStatus;
  progress: number;
  error?: string;
}

const makeId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const UploadZone: React.FC<UploadZoneProps> = ({
  categoryId: presetCategoryId,
  onUploadComplete,
  compact = false,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  // Files the user just picked/dropped, buffered while the pre-upload
  // configuration modal is open. They are NOT yet enqueued/uploading;
  // confirming the modal moves them into the real queue, cancelling
  // discards them.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  // Modal-local draft state. These are only applied to the batch when the
  // user confirms; we don't keep a separate "current selection" because
  // config is now per-batch via the modal.
  const [draftCategoryId, setDraftCategoryId] = useState<number | null>(
    presetCategoryId ?? null
  );
  const [draftTagIds, setDraftTagIds] = useState<number[]>([]);
  const [draftNote, setDraftNote] = useState('');
  const [tagsOpen, setTagsOpen] = useState(false);
  // Ref wrapping the tags trigger + dropdown so we can close the panel
  // when the user clicks anywhere outside of it (matches how the native
  // <select> used for Category auto-collapses on outside clicks).
  const tagsRef = useRef<HTMLDivElement | null>(null);

  // Protocol-identification results waiting for user confirmation. When
  // non-empty, the confirmation modal is shown. Items are accumulated across
  // the serial upload loop so the user only sees one modal per batch.
  const [pendingDetections, setPendingDetections] = useState<DetectionItem[]>([]);

  // User-curated set of protocols that should be pre-checked in the modal.
  // Fetched once on mount; undefined while loading (modal will fall back to
  // pre-checking everything detected).
  const enabledCatalog = useEnabledProtocols();

  useEffect(() => {
    if (presetCategoryId !== undefined) {
      setDraftCategoryId(presetCategoryId ?? null);
    }
  }, [presetCategoryId]);

  useEffect(() => {
    categoryApi.getCategories().then((res) => setCategories(res.data)).catch(() => {});
    tagApi.getTags().then((res) => setAllTags(res.data)).catch(() => {});
  }, []);

  // Close the custom Tags dropdown on any click outside of it. We listen
  // on ``mousedown`` (not ``click``) so the panel is already gone by the
  // time an actual click event would fire somewhere else in the modal,
  // which prevents the button's own onClick from re-toggling it open.
  useEffect(() => {
    if (!tagsOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const node = tagsRef.current;
      if (node && !node.contains(e.target as Node)) {
        setTagsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [tagsOpen]);

  const updateItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const removeItem = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setQueue((prev) => prev.filter((item) => item.status !== 'done'));
  }, []);

  /**
   * Upload files one at a time (serial). This keeps per-file progress
   * accurate, avoids saturating the network with many parallel POSTs,
   * and matches the backend's single-file upload endpoint semantics.
   *
   * Config (category/tags/note) is passed in explicitly rather than read
   * from component state, so a batch always uses the snapshot the user
   * confirmed in the modal — even if they open the modal again later
   * with different values while the previous batch is still running.
   */
  const processQueue = useCallback(
    async (
      items: QueueItem[],
      config: {
        categoryId: number | null;
        tagIds: number[];
        note: string;
      }
    ) => {
      let anyDone = false;
      const detections: DetectionItem[] = [];
      for (const item of items) {
        updateItem(item.id, { status: 'uploading', progress: 0, error: undefined });

        const formData = new FormData();
        formData.append('file', item.file);

        try {
          const res = await fileApi.uploadFile(formData, {
            categoryId: config.categoryId,
            tagIds: config.tagIds,
            note: config.note,
            onProgress: (percent) => updateItem(item.id, { progress: percent }),
          });
          updateItem(item.id, { status: 'done', progress: 100 });
          anyDone = true;

          // Collect the sharkd-detected summary for user confirmation.
          // We queue *every* file — even those with an empty detection —
          // so the user can still type one manually if they want.
          detections.push({
            fileId: res.data.file.id,
            fileName: res.data.file.name,
            suggested: res.data.suggested_summary || '',
          });
        } catch (err: unknown) {
          // Prefer the backend's structured error body when available.
          // A 409 from our duplicate-file guard ships a helpful
          // `detail.message`; surface that verbatim so the user sees
          // "File already exists: foo.pcap" instead of a generic
          // "Request failed with status 409".
          let msg = 'Upload failed';
          if (axios.isAxiosError(err)) {
            const detail = err.response?.data?.detail;
            if (typeof detail === 'string') {
              msg = detail;
            } else if (detail && typeof detail === 'object' && 'message' in detail) {
              msg = String((detail as { message?: unknown }).message ?? msg);
            } else if (err.message) {
              msg = err.message;
            }
          } else if (err instanceof Error) {
            msg = err.message;
          }
          updateItem(item.id, { status: 'error', error: msg });
        }
      }
      if (anyDone) {
        onUploadComplete();
      }
      // Present the confirmation modal after the whole batch is done,
      // but only if at least one file actually needs a decision.
      if (detections.length > 0) {
        setPendingDetections((prev) => [...prev, ...detections]);
      }
    },
    [onUploadComplete, updateItem]
  );

  /**
   * Buffer the picked files and open the pre-upload config modal. We don't
   * enqueue into the real upload queue until the user confirms — that way
   * "Cancel" is a real cancel (no files were touched/uploaded).
   */
  const bufferFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      const arr = Array.from(files);
      if (arr.length === 0) return;

      // Reset draft selections each time the modal opens so stale values
      // from a previous batch don't silently apply. Keep category so the
      // next batch lands in the same bucket by default (common workflow).
      setDraftTagIds([]);
      setDraftNote('');
      setTagsOpen(false);
      setPendingFiles(arr);
    },
    []
  );

  const cancelPending = useCallback(() => {
    setPendingFiles([]);
    setTagsOpen(false);
  }, []);

  const confirmPending = useCallback(async () => {
    const files = pendingFiles;
    if (files.length === 0) {
      setPendingFiles([]);
      return;
    }

    const newItems: QueueItem[] = files.map((file) => ({
      id: makeId(),
      file,
      status: 'pending' as QueueStatus,
      progress: 0,
    }));

    // Snapshot config at confirm-time so changes to the drafts after this
    // point (if the modal is reopened) don't leak into the running batch.
    const config = {
      categoryId: draftCategoryId,
      tagIds: draftTagIds,
      note: draftNote,
    };

    setQueue((prev) => [...prev, ...newItems]);
    setPendingFiles([]);
    setTagsOpen(false);

    // Guard against starting a second processing loop while one is
    // already running. If a loop is already active, the newly-added
    // items will remain pending until it finishes — but we always kick
    // off a new loop here because the previous call's `processQueue`
    // only iterates the items it was given.
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await processQueue(newItems, config);
    } finally {
      setIsProcessing(false);
    }
  }, [pendingFiles, draftCategoryId, draftTagIds, draftNote, isProcessing, processQueue]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      bufferFiles(e.dataTransfer.files);
    },
    [bufferFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const toggleDraftTag = useCallback((id: number) => {
    setDraftTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const draftCategory = categories.find((c) => c.id === draftCategoryId) ?? null;
  const draftSelectedTags = allTags.filter((t) => draftTagIds.includes(t.id));

  const doneCount = queue.filter((q) => q.status === 'done').length;
  const errorCount = queue.filter((q) => q.status === 'error').length;
  const activeCount = queue.filter(
    (q) => q.status === 'pending' || q.status === 'uploading'
  ).length;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const modalOpen = pendingFiles.length > 0;

  return (
    <div className="space-y-2">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative rounded-xl border-2 border-dashed transition-all duration-300 ${
          isDragOver
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : 'border-dark-500 bg-dark-700/30 hover:border-dark-400'
        }`}
      >
        <label
          className={`flex flex-col items-center cursor-pointer ${
            compact ? 'py-5 px-3 text-center' : 'py-8'
          }`}
        >
          <Upload
            size={compact ? 22 : 28}
            className={`${compact ? 'mb-1.5' : 'mb-2'} transition-colors ${
              isDragOver ? 'text-primary' : 'text-muted-dark'
            }`}
          />
          <p className={`${compact ? 'text-xs' : 'text-sm'} text-muted mb-1 leading-snug`}>
            {compact ? 'Drop files or ' : 'Drag and drop files here or '}
            <span className="text-primary hover:underline">
              {compact ? 'browse' : 'Click to upload'}
            </span>
          </p>
          <p className={`${compact ? 'text-[10px]' : 'text-xs'} text-muted-dark`}>
            {compact
              ? '.pcap .pcapng .cap · max 500MB each'
              : 'Supports .pcap .pcapng .cap files, max 500MB each · multiple files supported'}
          </p>
          <input
            type="file"
            accept=".pcap,.pcapng,.cap"
            multiple
            className="hidden"
            onChange={(e) => {
              bufferFiles(e.target.files);
              // Reset so the same file can be selected again later.
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {/* Upload queue */}
      {queue.length > 0 && (
        <div className="rounded-lg bg-dark-700/50 border border-dark-600 p-2 space-y-1.5">
          {/* Queue header with summary + clear button */}
          <div className="flex items-center justify-between px-1 pb-1 border-b border-dark-600/50">
            <span className="text-[11px] text-muted-dark">
              {activeCount > 0
                ? `Uploading ${activeCount}/${queue.length}`
                : errorCount > 0
                ? `${doneCount} done, ${errorCount} failed`
                : `${doneCount} uploaded`}
            </span>
            {activeCount === 0 && doneCount > 0 && (
              <button
                onClick={clearFinished}
                className="text-[10px] text-muted hover:text-white transition-colors"
              >
                Clear finished
              </button>
            )}
          </div>

          {/* Queue items */}
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {queue.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 px-1 py-1.5 rounded hover:bg-dark-600/30 transition-colors group"
              >
                {/* Status icon */}
                <div className="flex-shrink-0 mt-0.5">
                  {item.status === 'done' ? (
                    <CheckCircle2 size={14} className="text-success" />
                  ) : item.status === 'error' ? (
                    <AlertCircle size={14} className="text-danger" />
                  ) : item.status === 'uploading' ? (
                    <FileUp size={14} className="text-primary animate-bounce" />
                  ) : (
                    <FileUp size={14} className="text-muted-dark" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] text-white font-medium truncate">
                      {item.file.name}
                    </span>
                    <span className="text-[10px] text-muted-dark flex-shrink-0">
                      {formatSize(item.file.size)}
                    </span>
                    {item.status === 'uploading' && (
                      <span className="text-[10px] text-primary ml-auto flex-shrink-0">
                        {item.progress}%
                      </span>
                    )}
                  </div>

                  {item.status === 'uploading' && (
                    <div className="w-full h-1 bg-dark-600 rounded-full overflow-hidden mt-1">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-300"
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  )}

                  {item.status === 'error' && item.error && (
                    <p className="text-[10px] text-danger mt-0.5 truncate" title={item.error}>
                      {item.error}
                    </p>
                  )}
                </div>

                {/* Remove (pending only) or dismiss (done/error) */}
                {item.status !== 'uploading' && (
                  <button
                    onClick={() => removeItem(item.id)}
                    className="flex-shrink-0 p-0.5 rounded text-muted-dark hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                    title="Remove"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pre-upload configuration modal. Shown after the user picks/drops
          files but before anything is actually uploaded, so they can set
          category / tags / note per batch and cancel if they change their
          mind. */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={cancelPending}
        >
          <div
            className="w-[92vw] max-w-md rounded-xl bg-dark-700 border border-dark-500 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-600">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Upload {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}
                </h3>
                <p className="text-[11px] text-muted-dark mt-0.5">
                  Choose where they go and add an optional note.
                </p>
              </div>
              <button
                onClick={cancelPending}
                className="p-1 rounded text-muted-dark hover:text-white hover:bg-dark-600 transition-colors"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="px-4 py-3 space-y-3">
              {/* File list preview (scrolls if many) */}
              <div className="max-h-28 overflow-y-auto rounded-lg bg-dark-800/60 border border-dark-600 p-2 space-y-1">
                {pendingFiles.map((f, i) => (
                  <div
                    key={`${f.name}-${i}`}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="text-muted truncate">{f.name}</span>
                    <span className="text-muted-dark flex-shrink-0">
                      {formatSize(f.size)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Category */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted mb-1.5">
                  <FolderTree size={12} className="text-muted-dark" />
                  Category
                </label>
                <div className="relative">
                  <select
                    value={draftCategoryId ?? ''}
                    onChange={(e) =>
                      setDraftCategoryId(
                        e.target.value ? parseInt(e.target.value, 10) : null
                      )
                    }
                    className="w-full appearance-none pl-3 pr-7 py-2 rounded-lg bg-dark-600 border border-dark-500 text-xs text-white hover:border-dark-400 focus:border-primary focus:outline-none cursor-pointer transition-colors"
                  >
                    <option value="">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={12}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-dark pointer-events-none"
                  />
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted mb-1.5">
                  <TagsIcon size={12} className="text-muted-dark" />
                  Tags
                </label>
                <div className="relative" ref={tagsRef}>
                  <button
                    type="button"
                    onClick={() => setTagsOpen((v) => !v)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-dark-600 border border-dark-500 text-xs text-white hover:border-dark-400 focus:border-primary focus:outline-none transition-colors"
                  >
                    <span className="flex-1 text-left truncate">
                      {draftSelectedTags.length === 0
                        ? 'No tags'
                        : draftSelectedTags.length === 1
                        ? draftSelectedTags[0].name
                        : `${draftSelectedTags.length} tags`}
                    </span>
                    <ChevronDown
                      size={12}
                      className={`text-muted-dark transition-transform ${
                        tagsOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {tagsOpen && (
                    <div className="absolute z-10 mt-1 left-0 right-0 max-h-48 overflow-y-auto rounded-lg bg-dark-700 border border-dark-500 shadow-xl p-1.5">
                      {allTags.length === 0 ? (
                        <p className="text-[11px] text-muted-dark text-center py-3">
                          No tags yet. Create some on the Tags page.
                        </p>
                      ) : (
                        allTags.map((tag) => {
                          const active = draftTagIds.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => toggleDraftTag(tag.id)}
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
                              <span className="flex-1 text-left truncate">
                                {tag.name}
                              </span>
                              {active && (
                                <span className="text-primary text-[10px]">✓</span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* Selected tags preview chips */}
                {draftSelectedTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {draftSelectedTags.map((tag) => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
                        style={{
                          backgroundColor: `${tag.color}20`,
                          color: tag.color,
                          border: `1px solid ${tag.color}40`,
                        }}
                      >
                        {tag.name}
                        <button
                          onClick={() => toggleDraftTag(tag.id)}
                          className="hover:opacity-70"
                          title="Remove"
                        >
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Note */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted mb-1.5">
                  <StickyNote size={12} className="text-muted-dark" />
                  Note
                </label>
                <textarea
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value)}
                  placeholder="Optional — applied to every file in this batch"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-dark-600 border border-dark-500 text-xs text-white placeholder:text-muted-dark hover:border-dark-400 focus:border-primary focus:outline-none transition-colors resize-none"
                />
              </div>

              {draftCategory && (
                <p className="text-[10px] text-muted-dark">
                  → will be saved to{' '}
                  <span className="text-primary">{draftCategory.name}</span>
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-dark-600">
              <button
                onClick={cancelPending}
                className="px-3 py-1.5 rounded-lg text-xs text-muted hover:text-white hover:bg-dark-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmPending}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-primary hover:bg-primary/90 transition-colors"
              >
                Start upload
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Protocol-detection confirmation (shown after a batch finishes). */}
      {pendingDetections.length > 0 && (
        <ConfirmProtocolSummaryModal
          items={pendingDetections}
          enabledCatalog={enabledCatalog}
          onSave={async (fileId, summary) => {
            try {
              await fileApi.setProtocolSummary(fileId, summary);
              return true;
            } catch {
              return false;
            }
          }}
          onFinished={() => {
            // Refresh the file list so the newly-saved protocol_summary
            // shows up right away.
            onUploadComplete();
          }}
          onClose={() => setPendingDetections([])}
        />
      )}
    </div>
  );
};

export default UploadZone;
