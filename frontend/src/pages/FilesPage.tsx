import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderOpen, Download, Trash2, X, Share2 } from 'lucide-react';
import UploadZone from '../components/Files/UploadZone';
import FileToolbar from '../components/Files/FileToolbar';
import FileTable, { SortOrder } from '../components/Files/FileTable';
import FileGrid from '../components/Files/FileGrid';
import RightPanel from '../components/RightPanel/RightPanel';
import PageHeader from '../components/common/PageHeader';
import Pagination from '../components/common/Pagination';
import ShareResultModal, { ShareResult, ShareError } from '../components/Files/ShareResultModal';
import { useFileStore } from '../stores/fileStore';
import { useCategoryStore } from '../stores/categoryStore';
import { useUIStore } from '../stores/uiStore';
import { fileApi } from '../api/files';
import { shareApi } from '../api/share';
import { tagApi } from '../api/tags';
import { Tag } from '../types';

const FilesPage: React.FC = () => {
  const [searchParams, setSearchParamsUrl] = useSearchParams();
  const {
    files,
    total,
    page,
    pageSize,
    fetchFiles,
    toggleFavorite,
    deleteFile,
    bulkDeleteFiles,
    changeCategory,
    changeTags,
    setSearchParams: setStoreParams,
    setPage,
    setPageSize,
    selectedIds,
    toggleSelect,
    selectMany,
    clearSelection,
  } = useFileStore();
  const { categories, fetchCategories } = useCategoryStore();
  const { viewMode, setViewMode } = useUIStore();

  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState('upload_time');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [selectedProtocols, setSelectedProtocols] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>(searchParams.get('q') || '');

  // Candidate protocols for the filter dropdown. We ask the backend for
  // every protocol that appears in ANY file's `protocol_summary` — this
  // is intentionally NOT gated by the user's "enabled protocols" setting
  // on the Protocols page. That setting only controls which chips get
  // pre-checked in the upload confirmation modal; it must not shrink the
  // retrospective filter to a subset that hides existing files.
  //
  // We refetch whenever the current files list changes (length or the
  // concatenated protocol_summary fingerprint) so newly-uploaded files
  // and edits immediately surface new protocols in the dropdown.
  const [protocolOptions, setProtocolOptions] = useState<string[]>([]);
  const protocolsFingerprint = files
    .map((f) => `${f.id}:${f.protocol_summary ?? ''}`)
    .join('|');
  useEffect(() => {
    let cancelled = false;
    fileApi
      .getUsedProtocols()
      .then((res) => {
        if (!cancelled) setProtocolOptions(res.data);
      })
      .catch(() => {
        if (!cancelled) setProtocolOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [protocolsFingerprint]);

  const refreshTags = useCallback(async () => {
    const res = await tagApi.getTags();
    setTags(res.data);
  }, []);

  useEffect(() => {
    fetchCategories();
    refreshTags();
  }, []);

  // Sync selected category from URL (?category_id=...) so deep-links from
  // CategoriesPage land on a pre-filtered view. Supports either a single
  // id (?category_id=1) or a comma-separated list (?category_id=1,2).
  useEffect(() => {
    const urlCatId = searchParams.get('category_id');
    if (urlCatId) {
      const parsed = urlCatId
        .split(',')
        .map((x) => parseInt(x, 10))
        .filter((x) => !Number.isNaN(x));
      if (parsed.length > 0) {
        setSelectedCategoryIds(parsed);
      }
    }
    const urlQ = searchParams.get('q') || '';
    setSearchQuery(urlQ);
  }, [searchParams]);

  // Any filter/sort/search change should reset to page 1.
  useEffect(() => {
    setStoreParams({
      q: searchQuery || undefined,
      category_id: undefined,
      category_ids: selectedCategoryIds.length > 0 ? selectedCategoryIds : undefined,
      sort_by: sortBy,
      sort_order: sortOrder,
      tag_ids: selectedTagIds.length > 0 ? selectedTagIds : undefined,
      protocols: selectedProtocols.length > 0 ? selectedProtocols : undefined,
      file_type: undefined,
      page: 1,
    });
    // Selection is a page-level concept. When filters change, the rows
    // under the current viewport change too, so any previous tick state
    // would be ambiguous ("did I mean to include the rows that just
    // fell out of view?"). Simpler and less error-prone to clear it.
    clearSelection();
    fetchFiles();
  }, [selectedCategoryIds, sortBy, sortOrder, selectedTagIds, selectedProtocols, searchQuery]);

  const handleSearchChange = useCallback(
    (q: string) => {
      setSearchQuery(q);
      const next = new URLSearchParams(searchParams);
      if (q) {
        next.set('q', q);
      } else {
        next.delete('q');
      }
      setSearchParamsUrl(next, { replace: true });
    },
    [searchParams, setSearchParamsUrl]
  );

  const handleSortChange = useCallback(
    (field: string, order: SortOrder) => {
      setSortBy(field);
      setSortOrder(order);
    },
    []
  );

  const handlePageChange = useCallback(
    (nextPage: number) => {
      setPage(nextPage);
      // Clear selection when leaving the current page — carrying over
      // invisible selections across pages would surprise users.
      clearSelection();
      fetchFiles();
    },
    [setPage, fetchFiles, clearSelection]
  );

  const handlePageSizeChange = useCallback(
    (size: number) => {
      setPageSize(size);
      clearSelection();
      fetchFiles();
    },
    [setPageSize, fetchFiles, clearSelection]
  );

  const handleUploadComplete = useCallback(() => {
    fetchFiles();
    fetchCategories();
  }, []);

  const handleDownload = useCallback(async (id: number, name: string) => {
    const res = await fileApi.downloadFile(id);
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    window.URL.revokeObjectURL(url);
  }, []);

  // ---- Bulk actions ------------------------------------------------------

  const [bulkBusy, setBulkBusy] = useState<null | 'download' | 'delete' | 'share'>(null);
  const [shareModalData, setShareModalData] = useState<{ shared: ShareResult[]; errors: ShareError[] } | null>(null);
  const selectedCount = selectedIds.size;

  const handleToggleSelectPage = useCallback(
    (checked: boolean) => {
      selectMany(files.map((f) => f.id), checked);
    },
    [files, selectMany]
  );

  const handleBulkDownload = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy('download');
    try {
      const ids = Array.from(selectedIds);
      const res = await fileApi.bulkDownload(ids);
      // Prefer the filename the backend advertised in Content-Disposition
      // so single-file downloads keep their original name. Fall back to
      // a generic archive name if the header isn't present.
      const disp = (res.headers?.['content-disposition'] || '') as string;
      const match = /filename\*?=(?:UTF-8''|")?([^";]+)"?/i.exec(disp);
      const fallback = `pcaphouse_${ids.length}_files.zip`;
      const filename = match ? decodeURIComponent(match[1]) : fallback;

      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: 'application/zip' })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // No toast framework yet; fall back to a plain alert so the user
      // at least hears about the failure.
      // eslint-disable-next-line no-alert
      alert('Bulk download failed. Please try again.');
      console.error('Bulk download failed:', err);
    } finally {
      setBulkBusy(null);
    }
  }, [selectedIds]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `Delete ${selectedIds.size} file${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`
    );
    if (!ok) return;
    setBulkBusy('delete');
    try {
      const ids = Array.from(selectedIds);
      const { deleted, missing } = await bulkDeleteFiles(ids);
      // If some files were already gone on the server (e.g. deleted from
      // another tab), just refetch so the list reflects reality.
      if (missing.length > 0) {
        await fetchFiles();
      }
      // If the current page is now empty but earlier pages have content,
      // step back one page so the user isn't staring at an empty view.
      const nextTotal = total - deleted.length;
      const maxPage = Math.max(1, Math.ceil(nextTotal / pageSize));
      if (page > maxPage) {
        setPage(maxPage);
        await fetchFiles();
      }
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert('Bulk delete failed. Please try again.');
      console.error('Bulk delete failed:', err);
    } finally {
      setBulkBusy(null);
    }
  }, [selectedIds, bulkDeleteFiles, fetchFiles, total, pageSize, page, setPage]);

  const handleBulkShare = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy('share');
    try {
      const ids = Array.from(selectedIds);
      const res = await shareApi.shareFiles(ids);
      const { shared, errors } = res.data;
      setShareModalData({
        shared: shared.map((s: { file_name: string; cos_url: string }) => ({
          fileName: s.file_name,
          cosUrl: s.cos_url,
        })),
        errors: errors.map((e: { file_id: number; message: string }) => ({
          fileId: e.file_id,
          message: e.message,
        })),
      });
      clearSelection();
    } catch (err) {
      setShareModalData({
        shared: [],
        errors: [{ fileId: 0, message: 'Share failed. Please check share COS config.' }],
      });
      console.error('Bulk share failed:', err);
    } finally {
      setBulkBusy(null);
    }
  }, [selectedIds, clearSelection]);

  const handleShareSingle = useCallback(async (fileId: number) => {
    try {
      const res = await shareApi.shareFiles([fileId]);
      const { shared, errors } = res.data;
      setShareModalData({
        shared: shared.map((s: { file_name: string; cos_url: string }) => ({
          fileName: s.file_name,
          cosUrl: s.cos_url,
        })),
        errors: errors.map((e: { file_id: number; message: string }) => ({
          fileId: e.file_id,
          message: e.message,
        })),
      });
    } catch (err) {
      setShareModalData({
        shared: [],
        errors: [{ fileId: fileId, message: 'Share failed. Please check share COS config.' }],
      });
      console.error('Share failed:', err);
    }
  }, []);

  return (
    <div className="flex gap-6 h-full min-h-0">
      {/* Main Content — fills height, scroll confined to list area */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        {/* Page Header */}
        <PageHeader
          icon={<FolderOpen size={24} className="text-primary" />}
          title="All Files"
          description="Network capture files uploaded and managed in your repository"
        />

        {/* File Toolbar (search + filters + view mode) */}
        <FileToolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          tags={tags}
          selectedTagIds={selectedTagIds}
          onTagFilter={setSelectedTagIds}
          categories={categories}
          selectedCategoryIds={selectedCategoryIds}
          onCategoryFilter={setSelectedCategoryIds}
          protocolOptions={protocolOptions}
          selectedProtocols={selectedProtocols}
          onProtocolFilter={setSelectedProtocols}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          totalFiles={total}
        />

        {/* Bulk-selection bar — only visible when something is ticked.
            Sits between the toolbar and the list so it's obvious what
            the buttons act on, and doesn't shift layout when empty. */}
        {selectedCount > 0 && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center justify-center h-6 min-w-6 px-2 rounded-full bg-primary/20 text-primary text-xs font-semibold">
                {selectedCount}
              </span>
              <span className="text-white">
                {selectedCount === 1 ? 'file selected' : 'files selected'}
              </span>
              <button
                type="button"
                onClick={clearSelection}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-white transition-colors ml-2"
              >
                <X size={12} />
                Clear
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBulkShare}
                disabled={bulkBusy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-dark-700 hover:bg-dark-600 border border-dark-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Share2 size={14} />
                {bulkBusy === 'share' ? 'Sharing…' : 'Share'}
              </button>
              <button
                type="button"
                onClick={handleBulkDownload}
                disabled={bulkBusy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-dark-700 hover:bg-dark-600 border border-dark-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Download size={14} />
                {bulkBusy === 'download' ? 'Packaging…' : 'Download'}
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={bulkBusy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-danger/10 hover:bg-danger/20 border border-danger/40 text-danger disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Trash2 size={14} />
                {bulkBusy === 'delete' ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}

        {/* File List — flex-1 so it fills remaining space; internal scroll. */}
        <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-dark-600 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-auto">
            {viewMode === 'list' ? (
              <FileTable
                files={files}
                categories={categories}
                allTags={tags}
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSortChange={handleSortChange}
                onToggleFavorite={toggleFavorite}
                onDelete={deleteFile}
                onDownload={handleDownload}
                onShare={handleShareSingle}
                onChangeCategory={changeCategory}
                onChangeTags={(id, ids) => changeTags(id, ids, tags)}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectPage={handleToggleSelectPage}
              />
            ) : (
              <div className="p-3">
                <FileGrid
                  files={files}
                  onToggleFavorite={toggleFavorite}
                  onDelete={deleteFile}
                  onDownload={handleDownload}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                />
              </div>
            )}
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </div>
      </div>

      {/* Right Panel — independently scrollable */}
      <div className="flex-shrink-0 h-full overflow-y-auto">
        <RightPanel
          uploadSlot={
            <UploadZone
              onUploadComplete={handleUploadComplete}
              compact
            />
          }
        />
      </div>

      {/* Share Result Modal */}
      {shareModalData && (
        <ShareResultModal
          shared={shareModalData.shared}
          errors={shareModalData.errors}
          onClose={() => setShareModalData(null)}
        />
      )}
    </div>
  );
};

export default FilesPage;
