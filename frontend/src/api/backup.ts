import apiClient from './client';

/**
 * Shape returned by ``GET /backup/config``. Secrets are returned masked
 * — the full values never leave the backend once saved. Booleans
 * ``has_secret_id`` / ``has_secret_key`` tell the UI whether a secret
 * is already configured without having to parse the masked string.
 */
export interface BackupConfig {
  bucket: string;
  region: string;
  secret_id_masked: string;
  secret_key_masked: string;
  has_secret_id: boolean;
  has_secret_key: boolean;
  path_prefix: string;
  enabled: boolean;
  schedule_time: string; // "HH:MM"

  last_status: string | null;
  last_run_at: string | null;
  last_object_key: string | null;
  last_size_bytes: number | null;
  last_message: string | null;
}

/** Partial payload for ``PUT /backup/config``. Only include what changed. */
export interface BackupConfigUpdate {
  bucket?: string;
  region?: string;
  secret_id?: string;
  secret_key?: string;
  path_prefix?: string;
  enabled?: boolean;
  schedule_time?: string;
}

export interface BackupRunResult {
  status: 'success' | 'failed';
  message: string;
  object_key?: string | null;
  size_bytes?: number | null;
  duration_ms?: number | null;
}

export interface BackupRecord {
  id: number;
  trigger: 'manual' | 'scheduled';
  status: 'success' | 'failed';
  object_key: string | null;
  size_bytes: number | null;
  duration_ms: number | null;
  message: string | null;
  created_at: string;
}

export const backupApi = {
  getConfig: () => apiClient.get<BackupConfig>('/backup/config'),
  updateConfig: (data: BackupConfigUpdate) =>
    apiClient.put<BackupConfig>('/backup/config', data),
  testConnection: () =>
    apiClient.post<BackupRunResult>('/backup/test-connection'),
  runNow: () => apiClient.post<BackupRunResult>('/backup/run-now'),
  getHistory: (limit = 20) =>
    apiClient.get<BackupRecord[]>('/backup/history', { params: { limit } }),
};
