import { create } from 'zustand';
import { PcapFile, FileListResponse, SearchParams, Tag } from '../types';
import { fileApi } from '../api/files';

interface FileStore {
  files: PcapFile[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  searchParams: SearchParams;

  /**
   * Ids of the files the user has ticked in the list/grid. Kept as a
   * Set for O(1) membership checks from row renderers. Selection is a
   * page-level UI concern only; it is cleared automatically whenever
   * filters/sort/search/page change (see `FilesPage`).
   */
  selectedIds: Set<number>;
  isSelected: (id: number) => boolean;
  toggleSelect: (id: number) => void;
  selectMany: (ids: number[], checked: boolean) => void;
  clearSelection: () => void;

  setSearchParams: (params: Partial<SearchParams>) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  fetchFiles: () => Promise<void>;
  toggleFavorite: (id: number) => Promise<void>;
  deleteFile: (id: number) => Promise<void>;
  /** Delete all given ids in one round-trip. Returns #deleted. */
  bulkDeleteFiles: (ids: number[]) => Promise<{ deleted: number[]; missing: number[] }>;
  changeCategory: (id: number, categoryId: number | null) => Promise<void>;
  changeTags: (id: number, tagIds: number[], allTags: Tag[]) => Promise<void>;
}

const DEFAULT_PAGE_SIZE = 20;

export const useFileStore = create<FileStore>((set, get) => ({
  files: [],
  total: 0,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  loading: false,
  searchParams: { page: 1, page_size: DEFAULT_PAGE_SIZE },

  selectedIds: new Set<number>(),

  isSelected: (id) => get().selectedIds.has(id),

  toggleSelect: (id) => {
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    });
  },

  selectMany: (ids, checked) => {
    set((state) => {
      const next = new Set(state.selectedIds);
      if (checked) {
        for (const id of ids) next.add(id);
      } else {
        for (const id of ids) next.delete(id);
      }
      return { selectedIds: next };
    });
  },

  clearSelection: () => set({ selectedIds: new Set<number>() }),

  setSearchParams: (params) => {
    set((state) => ({
      searchParams: { ...state.searchParams, ...params },
    }));
  },

  setPage: (page) => {
    set((state) => ({
      page,
      searchParams: { ...state.searchParams, page },
    }));
  },

  setPageSize: (pageSize) => {
    set((state) => ({
      pageSize,
      page: 1,
      searchParams: { ...state.searchParams, page: 1, page_size: pageSize },
    }));
  },

  fetchFiles: async () => {
    set({ loading: true });
    const { searchParams } = get();
    // The backend expects `tag_ids` / `category_ids` as comma-separated
    // strings (e.g. "1,2,3"), not arrays. Axios would otherwise serialize
    // the array as repeated params which the backend doesn't accept →
    // the filter silently becomes a no-op.
    const { tag_ids, category_ids, protocols, ...rest } = searchParams;
    const apiParams: Record<string, unknown> = { ...rest };
    if (tag_ids && tag_ids.length > 0) {
      apiParams.tag_ids = tag_ids.join(',');
    }
    if (category_ids && category_ids.length > 0) {
      apiParams.category_ids = category_ids.join(',');
    }
    if (protocols && protocols.length > 0) {
      // Backend expects a single comma-separated string (same convention
      // as tag_ids / category_ids) so it can OR them with whole-token
      // matching against protocol_summary.
      apiParams.protocols = protocols.join(',');
    }
    const res = await fileApi.getFiles(apiParams);
    const data: FileListResponse = res.data;
    set({
      files: data.files,
      total: data.total,
      page: data.page,
      pageSize: data.page_size,
      loading: false,
    });
  },

  toggleFavorite: async (id) => {
    await fileApi.toggleFavorite(id);
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id ? { ...f, is_favorite: !f.is_favorite } : f
      ),
    }));
  },

  deleteFile: async (id) => {
    await fileApi.deleteFile(id);
    set((state) => {
      const nextSel = new Set(state.selectedIds);
      nextSel.delete(id);
      return {
        files: state.files.filter((f) => f.id !== id),
        total: state.total - 1,
        selectedIds: nextSel,
      };
    });
  },

  bulkDeleteFiles: async (ids) => {
    const res = await fileApi.bulkDelete(ids);
    const deleted = new Set(res.data.deleted);
    set((state) => {
      const nextSel = new Set(state.selectedIds);
      for (const id of deleted) nextSel.delete(id);
      return {
        files: state.files.filter((f) => !deleted.has(f.id)),
        total: Math.max(0, state.total - deleted.size),
        selectedIds: nextSel,
      };
    });
    return res.data;
  },

  changeCategory: async (id, categoryId) => {
    // Call backend first; on success replace the file entry with the
    // server-returned one so `category` (nested object) stays consistent.
    const res = await fileApi.moveFile(id, categoryId);
    const updated = res.data;
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, ...updated } : f)),
    }));
  },

  changeTags: async (id, tagIds, allTags) => {
    await fileApi.updateFileTags(id, tagIds);
    // Re-derive the file's tag list locally from the provided catalog.
    const nextTags = allTags.filter((t) => tagIds.includes(t.id));
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id ? { ...f, tags: nextTags } : f
      ),
    }));
  },
}));
