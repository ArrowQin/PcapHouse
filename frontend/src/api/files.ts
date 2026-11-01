import apiClient from './client';
import { PcapFile, FileListResponse } from '../types';

export interface UploadOptions {
  categoryId?: number | null;
  tagIds?: number[];
  note?: string;
  onProgress?: (percent: number) => void;
}

/** Result of an upload: the created file plus a detected-but-not-yet-saved protocol summary. */
export interface UploadResponse {
  file: PcapFile;
  suggested_summary: string;
}

/** Result of a protocol-summary preview (no DB write). */
export interface ProtocolSummaryPreview {
  file: PcapFile;
  suggested_summary: string;
}

export const fileApi = {
  getFiles: (params: Record<string, unknown> = {}) =>
    apiClient.get<FileListResponse>('/files', { params }),

  /**
   * All protocol short-names that appear in at least one file's
   * `protocol_summary`. Used to populate the Files page's protocol
   * filter dropdown. Intentionally NOT gated by the "enabled protocols"
   * setting — the filter shows every protocol the library actually has.
   */
  getUsedProtocols: () =>
    apiClient.get<string[]>('/files/protocols/used'),

  /**
   * Library-wide protocol distribution used by the Dashboard donut
   * chart. Each file contributes +1 to every distinct protocol that
   * appears in its ``protocol_summary`` (duplicate tokens within one
   * file's summary collapse to a single contribution). Sorted by count
   * desc, then name asc.
   */
  getProtocolDistribution: () =>
    apiClient.get<{ name: string; count: number }[]>(
      '/files/protocols/distribution'
    ),

  getFile: (id: number) =>
    apiClient.get<PcapFile>(`/files/${id}`),

  uploadFile: (formData: FormData, options: UploadOptions = {}) => {
    const params: Record<string, string | number> = {};
    if (options.categoryId) params.category_id = options.categoryId;
    if (options.tagIds && options.tagIds.length > 0) {
      params.tag_ids = options.tagIds.join(',');
    }
    // Only send `note` when non-empty so the backend sees "not set"
    // rather than "set to empty string" for files uploaded without one.
    if (options.note && options.note.trim().length > 0) {
      params.note = options.note;
    }
    return apiClient.post<UploadResponse>('/files/upload', formData, {
      params,
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (options.onProgress && e.total) {
          options.onProgress(Math.round((e.loaded * 100) / e.total));
        }
      },
    });
  },

  downloadFile: (id: number) =>
    apiClient.get(`/files/${id}/download`, { responseType: 'blob' }),

  /**
   * Download multiple files as a single zip archive.
   *
   * Uses POST with a JSON body rather than a URL-encoded list so we
   * don't run into URL-length limits when hundreds of ids are selected.
   */
  bulkDownload: (ids: number[]) =>
    apiClient.post('/files/bulk/download', { ids }, { responseType: 'blob' }),

  deleteFile: (id: number) =>
    apiClient.delete(`/files/${id}`),

  /**
   * Delete multiple files in one request. Returns which ids were deleted
   * and which were already missing (so the UI can report partial success).
   */
  bulkDelete: (ids: number[]) =>
    apiClient.post<{ deleted: number[]; missing: number[] }>(
      '/files/bulk/delete',
      { ids }
    ),

  toggleFavorite: (id: number) =>
    apiClient.patch<PcapFile>(`/files/${id}/favorite`),

  moveFile: (id: number, categoryId: number | null) =>
    apiClient.patch<PcapFile>(`/files/${id}`, { category_id: categoryId }),

  /** Update a file's free-form note. Empty string clears it. */
  updateNote: (id: number, note: string) =>
    apiClient.patch<PcapFile>(`/files/${id}`, { note }),

  /** Rename a file (display name only, not the on-disk path). */
  renameFile: (id: number, name: string) =>
    apiClient.patch<PcapFile>(`/files/${id}`, { name }),

  updateFileTags: (id: number, tagIds: number[]) =>
    apiClient.put(`/files/${id}/tags`, { tag_ids: tagIds }),

  /** Run sharkd and return the detected protocols without persisting. */
  previewProtocolSummary: (id: number) =>
    apiClient.post<ProtocolSummaryPreview>(`/files/${id}/protocol-summary/preview`),

  /** Persist a user-confirmed protocol summary. Pass '' to clear. */
  setProtocolSummary: (id: number, summary: string) =>
    apiClient.patch<PcapFile>(`/files/${id}/protocol-summary`, { summary }),
};
