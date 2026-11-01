import apiClient from './client';

/** Shape of a shared file record. */
export interface SharedFile {
  id: number;
  file_id: number;
  file_name: string;
  object_key: string;
  cos_url: string;
  size_bytes: number;
  shared_at: string;
}

/** COS config for file sharing. */
export interface ShareConfig {
  bucket: string;
  region: string;
  secret_id_masked: string;
  secret_key_masked: string;
  has_secret_id: boolean;
  has_secret_key: boolean;
  path_prefix: string;
}

export interface ShareConfigUpdate {
  bucket?: string;
  region?: string;
  secret_id?: string;
  secret_key?: string;
  path_prefix?: string;
}

export interface ShareResponse {
  shared: SharedFile[];
  errors: { file_id: number; message: string }[];
}

export interface UnshareResponse {
  status: 'success' | 'failed';
  message: string;
}

export const shareApi = {
  getConfig: () => apiClient.get<ShareConfig>('/share/config'),
  updateConfig: (data: ShareConfigUpdate) =>
    apiClient.put<ShareConfig>('/share/config', data),
  testConnection: () =>
    apiClient.post<{ status: string; message: string }>('/share/test-connection'),
  shareFiles: (fileIds: number[]) =>
    apiClient.post<ShareResponse>('/share/files', { file_ids: fileIds }),
  listSharedFiles: () =>
    apiClient.get<SharedFile[]>('/share/files'),
  unshareFile: (shareId: number) =>
    apiClient.delete<UnshareResponse>(`/share/files/${shareId}`),
};
