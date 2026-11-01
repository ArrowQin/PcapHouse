import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Download,
  Trash2,
  Edit3,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Radar,
  Share2,
} from 'lucide-react';
import { Category, PcapFile, Tag } from '../../types';
import { fileApi } from '../../api/files';
import StarButton from '../common/StarButton';
import TagBadge from '../common/TagBadge';
import EditFileModal from './EditFileModal';
import ConfirmProtocolSummaryModal, {
  DetectionItem,
} from './ConfirmProtocolSummaryModal';
import { useEnabledProtocols } from '../../hooks/useEnabledProtocols';

export type SortOrder = 'asc' | 'desc';

interface FileTableProps {
  files: PcapFile[];
  categories: Category[];
  allTags: Tag[];
  sortBy: string;
  sortOrder: SortOrder;
  onSortChange: (sortBy: string, sortOrder: SortOrder) => void;
  onToggleFavorite: (id: number) => void;
  onDelete: (id: number) => void;
  onDownload: (id: number, name: string) => void;
  onShare?: (id: number) => void;
  onChangeCategory: (id: number, categoryId: number | null) => Promise<void>;
  onChangeTags: (id: number, tagIds: number[]) => Promise<void>;
  /** Selection (multi-select) — all optional so other callers don't break. */
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
  onToggleSelectPage?: (checked: boolean) => void;
}

/**
 * Clickable column header that supports 3-state sorting:
 *   inactive  → click → asc
 *   asc       → click → desc
 *   desc      → click → asc (toggle)
 */
interface SortableHeaderProps {
  label: string;
  field: string;
  sortBy: string;
  sortOrder: SortOrder;
  onSortChange: (field: string, order: SortOrder) => void;
  className?: string;
}

const SortableHeader: React.FC<SortableHeaderProps> = ({
  label,
  field,
  sortBy,
  sortOrder,
  onSortChange,
  className = '',
}) => {
  const active = sortBy === field;
  const nextOrder: SortOrder = active && sortOrder === 'asc' ? 'desc' : 'asc';
  const Icon = !active ? ArrowUpDown : sortOrder === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={`text-left px-4 py-3 ${className}`}>
      <button
        type="button"
        onClick={() => onSortChange(field, nextOrder)}
        className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
          active ? 'text-primary' : 'text-muted-dark hover:text-white'
        }`}
      >
        <span>{label}</span>
        <Icon size={11} className={active ? 'opacity-100' : 'opacity-50'} />
      </button>
    </th>
  );
};

const FileTable: React.FC<FileTableProps> = ({
  files,
  categories,
  allTags,
  sortBy,
  sortOrder,
  onSortChange,
  onToggleFavorite,
  onDelete,
  onDownload,
  onShare,
  onChangeCategory,
  onChangeTags,
  selectedIds,
  onToggleSelect,
  onToggleSelectPage,
}) => {
  const navigate = useNavigate();
  const [editing, setEditing] = useState<PcapFile | null>(null);
  // Queued detection results awaiting user confirmation. A single-item
  // queue (one file re-detected at a time) from this table.
  const [pendingDetections, setPendingDetections] = useState<DetectionItem[]>([]);
  const [detectingId, setDetectingId] = useState<number | null>(null);

  // Multi-select derivation — guarded so the table still renders without
  // selection wiring from the parent (e.g. other pages that reuse it).
  const selectionEnabled = !!selectedIds && !!onToggleSelect;
  const pageIds = files.map((f) => f.id);
  const selectedOnPage = selectionEnabled
    ? pageIds.filter((id) => selectedIds!.has(id)).length
    : 0;
  const allOnPageSelected =
    selectionEnabled && pageIds.length > 0 && selectedOnPage === pageIds.length;
  const someOnPageSelected = selectedOnPage > 0 && !allOnPageSelected;

  // User-curated enabled-set — decides which detected chips get pre-checked
  // in the confirmation modal. Loaded once per page mount.
  const enabledCatalog = useEnabledProtocols();

  const handleDetectProtocol = async (file: PcapFile) => {
    setDetectingId(file.id);
    try {
      const res = await fileApi.previewProtocolSummary(file.id);
      setPendingDetections([
        {
          fileId: file.id,
          fileName: file.name,
          suggested: res.data.suggested_summary || '',
        },
      ]);
    } catch {
      // Swallow — the modal simply won't open on failure. A toast would
      // be nicer but this app has no toast system yet.
    } finally {
      setDetectingId(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const getProtocolColor = (protocol: string) => {
    const colors: Record<string, string> = {
      TCP: '#3B82F6',
      UDP: '#22C55E',
      HTTP: '#F59E0B',
      HTTPS: '#8B5CF6',
      DNS: '#EC4899',
      ICMP: '#06B6D4',
      ARP: '#F97316',
    };
    return colors[protocol?.toUpperCase()] || '#64748B';
  };

  const handleEditSave = async (
    fileId: number,
    categoryId: number | null,
    tagIds: number[],
    protocolSummary: string | null,
    note: string | null,
    name: string | null
  ) => {
    // Only fire changes that actually differ from the current state.
    const target = files.find((f) => f.id === fileId);
    const tasks: Promise<void>[] = [];
    if (!target || target.category_id !== categoryId) {
      tasks.push(onChangeCategory(fileId, categoryId));
    }
    if (target) {
      const currentIds = target.tags.map((t) => t.id).sort();
      const nextIds = [...tagIds].sort();
      const changed =
        currentIds.length !== nextIds.length ||
        currentIds.some((v, i) => v !== nextIds[i]);
      if (changed) {
        tasks.push(onChangeTags(fileId, tagIds));
      }
    }
    // protocolSummary === null means the modal decided there was no change.
    // Any string (including '') is an explicit user edit, so we persist it
    // and patch the local cache so the table reflects it without refetch.
    if (protocolSummary !== null) {
      tasks.push(
        fileApi.setProtocolSummary(fileId, protocolSummary).then(() => {
          if (target) target.protocol_summary = protocolSummary;
        })
      );
    }
    // Same convention for note: null = unchanged.
    if (note !== null) {
      tasks.push(
        fileApi.updateNote(fileId, note).then(() => {
          if (target) target.note = note;
        })
      );
    }
    // Same convention for name: null = unchanged.
    if (name !== null) {
      tasks.push(
        fileApi.renameFile(fileId, name).then((res) => {
          if (target) target.name = res.data.name;
        })
      );
    }
    await Promise.all(tasks);
  };

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-dark">
        <FileText size={48} className="mb-4 opacity-30" />
        <p className="text-lg font-medium mb-1">No files found</p>
        <p className="text-sm">Upload some pcap files to get started</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="sticky top-0 bg-dark-800 z-10">
          <tr className="border-b border-dark-600">
            {selectionEnabled && (
              <th className="w-10 px-3 py-2">
                {/* Header checkbox selects / clears every row visible on
                    the current page. Uses indeterminate state when only
                    some page rows are ticked — clicking it in that case
                    selects the whole page, matching common UX patterns
                    (Gmail, GitHub, Linear, etc.). */}
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allOnPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someOnPageSelected;
                  }}
                  onChange={(e) => onToggleSelectPage?.(e.target.checked)}
                  className="h-4 w-4 accent-primary cursor-pointer"
                />
              </th>
            )}
            <SortableHeader
              label="Name"
              field="name"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSortChange={onSortChange}
            />
            {/* Category column is not sortable (it's a nested relation) */}
            <th className="text-left px-4 py-2 text-xs font-semibold text-muted-dark uppercase tracking-wider">
              Category
            </th>
            <SortableHeader
              label="Size"
              field="size"
              sortBy={sortBy}
              sortOrder={sortOrder}
              onSortChange={onSortChange}
            />
            <th className="text-left px-4 py-2 text-xs font-semibold text-muted-dark uppercase tracking-wider">
              Protocol
            </th>
            <th className="text-left px-4 py-2 text-xs font-semibold text-muted-dark uppercase tracking-wider">
              Note
            </th>
            <th className="text-left px-4 py-2 text-xs font-semibold text-muted-dark uppercase tracking-wider">
              Tags
            </th>
            <th className="w-32 px-4 py-2 text-xs font-semibold text-muted-dark uppercase tracking-wider">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => {
            const category =
              categories.find((c) => c.id === file.category_id) ?? null;
            const categoryName = category?.name ?? file.category?.name ?? null;
            const rowSelected = selectionEnabled && selectedIds!.has(file.id);
            return (
              <tr
                key={file.id}
                className={`border-b border-dark-600/50 hover:bg-dark-700/50 transition-colors cursor-pointer group ${
                  rowSelected ? 'bg-primary/5' : ''
                }`}
                onClick={() => navigate(`/pcap/${file.id}`)}
              >
                {selectionEnabled && (
                  <td
                    className="w-10 px-3 py-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${file.name}`}
                      checked={rowSelected}
                      onChange={() => onToggleSelect!(file.id)}
                      className="h-4 w-4 accent-primary cursor-pointer"
                    />
                  </td>
                )}
                <td className="px-4 py-1.5">
                  <span className="text-sm font-medium text-white truncate max-w-[280px] block">
                    {file.name}
                  </span>
                </td>
                <td className="px-4 py-1.5">
                  {categoryName ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-primary/10 text-primary">
                      {categoryName}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-dark">—</span>
                  )}
                </td>
                <td className="px-4 py-1.5 text-sm text-muted">
                  {formatSize(file.size)}
                </td>
                <td className="px-4 py-1.5" onClick={(e) => e.stopPropagation()}>
                  {file.protocol_summary ? (
                    (() => {
                      // Column space is tight, so we only render the first
                      // few chips inline and indicate the rest with a "+N"
                      // badge. On hover we pop a custom tooltip listing
                      // every protocol as a colored chip — the native
                      // `title` attribute was too slow (~1.5s delay) and
                      // ugly, so we use a Tailwind group-hover overlay
                      // instead. Named group (`group/proto`) keeps it
                      // isolated from the row-level `group` hover used
                      // for the action buttons.
                      const protos = file.protocol_summary
                        .split(',')
                        .map((p) => p.trim())
                        .filter(Boolean);
                      const MAX_VISIBLE = 3;
                      const visible = protos.slice(0, MAX_VISIBLE);
                      const hiddenCount = protos.length - visible.length;
                      return (
                        <div className="relative inline-block group/proto">
                          <div className="flex flex-wrap gap-1">
                            {visible.map((proto, i) => (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                style={{
                                  backgroundColor: `${getProtocolColor(proto)}20`,
                                  color: getProtocolColor(proto),
                                }}
                              >
                                {proto}
                              </span>
                            ))}
                            {hiddenCount > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-muted-dark bg-dark-700 border border-dark-500">
                                +{hiddenCount}
                              </span>
                            )}
                          </div>
                          {/* Tooltip: only shown when there's actually
                              something hidden OR any chip was truncated.
                              `pointer-events-none` so it never blocks
                              clicks on the row; `z-20` to sit above the
                              sticky header (z-10) and sibling rows. */}
                          {protos.length > 0 && (
                            <div
                              className="pointer-events-none invisible opacity-0 group-hover/proto:visible group-hover/proto:opacity-100 transition-opacity absolute left-0 top-full mt-1 z-20 bg-dark-800 border border-dark-600 rounded-lg shadow-lg px-2 py-1.5 whitespace-nowrap"
                            >
                              <div className="flex flex-wrap gap-1 max-w-[480px]">
                                {protos.map((proto, i) => (
                                  <span
                                    key={i}
                                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                    style={{
                                      backgroundColor: `${getProtocolColor(proto)}20`,
                                      color: getProtocolColor(proto),
                                    }}
                                  >
                                    {proto}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <button
                      onClick={() => handleDetectProtocol(file)}
                      disabled={detectingId === file.id}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-muted hover:text-primary hover:bg-primary/10 border border-dark-500 hover:border-primary/40 transition-all disabled:opacity-50"
                      title="Detect protocols via sharkd"
                    >
                      <Radar size={10} />
                      {detectingId === file.id ? 'Detecting…' : 'Detect'}
                    </button>
                  )}
                </td>
                {/* Note column: short, single-line preview. Full text is
                    shown via native tooltip on hover; editing happens in
                    the edit modal (Edit button in the action column). */}
                <td className="px-4 py-1.5 max-w-[220px]">
                  {file.note ? (
                    <span
                      className="block text-xs text-muted truncate"
                      title={file.note}
                    >
                      {file.note}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-dark">—</span>
                  )}
                </td>
                <td className="px-4 py-1.5">
                  {file.tags.length === 0 ? (
                    <span className="text-xs text-muted-dark">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {file.tags.slice(0, 3).map((t) => (
                        <TagBadge key={t.id} tag={t} size="sm" />
                      ))}
                      {file.tags.length > 3 && (
                        <span className="text-[10px] text-muted-dark self-center">
                          +{file.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-1.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1">
                    {/* Favorite is always visible so users can quickly scan
                        starred rows without hovering. */}
                    <StarButton
                      isFavorite={file.is_favorite}
                      onClick={() => onToggleFavorite(file.id)}
                      size={14}
                    />
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditing(file)}
                        className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-all"
                        title="Edit"
                      >
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => onDownload(file.id, file.name)}
                        className="p-1.5 rounded-lg text-muted hover:text-success hover:bg-success/10 transition-all"
                        title="Download"
                      >
                        <Download size={14} />
                      </button>
                      {onShare && (
                        <button
                          onClick={() => onShare(file.id)}
                          className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-all"
                          title="Share to COS"
                        >
                          <Share2 size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => onDelete(file.id)}
                        className="p-1.5 rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition-all"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editing && (
        <EditFileModal
          file={editing}
          categories={categories}
          allTags={allTags}
          onClose={() => setEditing(null)}
          onSave={handleEditSave}
        />
      )}

      {pendingDetections.length > 0 && (
        <ConfirmProtocolSummaryModal
          items={pendingDetections}
          enabledCatalog={enabledCatalog}
          onSave={async (fileId, summary) => {
            try {
              await fileApi.setProtocolSummary(fileId, summary);
              // Optimistically patch the in-memory file so the Protocol
              // column updates immediately without a full refetch. The
              // parent's store will still be out of sync until the next
              // fetch, but that's acceptable for this UX.
              const target = files.find((f) => f.id === fileId);
              if (target) target.protocol_summary = summary;
              return true;
            } catch {
              return false;
            }
          }}
          onClose={() => setPendingDetections([])}
        />
      )}
    </div>
  );
};

export default FileTable;
