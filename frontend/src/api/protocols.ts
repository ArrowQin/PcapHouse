import apiClient from './client';

export interface ProtocolConfig {
  id: number;
  name: string;
  enabled: boolean;
  description: string;
}

export interface ProtocolCatalog {
  protocols: string[];
  cached: boolean;
}

export const protocolApi = {
  /** Full list of protocols sharkd knows about (cached server-side). */
  getCatalog: () => apiClient.get<ProtocolCatalog>('/protocols/catalog'),

  /** User-defined enable/disable rows. */
  getConfigs: () => apiClient.get<ProtocolConfig[]>('/protocols/configs'),

  /** Shortcut: just the lowercased names currently enabled. */
  getEnabledNames: () => apiClient.get<string[]>('/protocols/enabled'),

  createConfig: (data: { name: string; enabled?: boolean; description?: string }) =>
    apiClient.post<ProtocolConfig>('/protocols/configs', data),

  updateConfig: (
    id: number,
    data: { enabled?: boolean; description?: string }
  ) => apiClient.patch<ProtocolConfig>(`/protocols/configs/${id}`, data),

  deleteConfig: (id: number) => apiClient.delete(`/protocols/configs/${id}`),

  /**
   * Replace the whole enabled-set atomically. Names in `enabledNames` become
   * enabled; every other existing row is disabled.
   */
  bulkSet: (enabledNames: string[]) =>
    apiClient.put<ProtocolConfig[]>('/protocols/configs/bulk', {
      enabled_names: enabledNames,
    }),
};
