import apiClient from './client';
import { PcapFile } from '../types';

/**
 * Inputs for POST /tools/decapsulate.
 *
 * The tool accepts a direct file upload — the source bytes are processed
 * entirely in memory on the server and are never persisted. Only the
 * decapsulated output ends up in the Files library (under the built-in
 * "Decapsulated" category).
 */
export interface DecapsulateRequest {
  file: File;
  strip_geneve?: boolean;
  geneve_port?: number;
  strip_vxlan?: boolean;
  vxlan_port?: number;
  filename?: string;
  onProgress?: (percent: number) => void;
}

/** Per-category packet counts returned by the backend. */
export interface DecapsulateStats {
  total: number;
  stripped_geneve: number;
  stripped_vxlan: number;
  stripped_both: number;
  passthrough: number;
  errors: number;
  warnings: string[];
}

export interface DecapsulateResponse {
  file: PcapFile;
  stats: DecapsulateStats;
}

export const toolsApi = {
  /**
   * Strip Geneve / VXLAN layers from an uploaded pcap.
   *
   * The upload is sent as multipart/form-data. The backend keeps the
   * bytes in RAM only — the source is never written to disk or added
   * to the library.
   */
  decapsulate(req: DecapsulateRequest) {
    const form = new FormData();
    form.append('file', req.file, req.file.name);
    if (req.strip_geneve !== undefined) {
      form.append('strip_geneve', String(req.strip_geneve));
    }
    if (req.geneve_port !== undefined) {
      form.append('geneve_port', String(req.geneve_port));
    }
    if (req.strip_vxlan !== undefined) {
      form.append('strip_vxlan', String(req.strip_vxlan));
    }
    if (req.vxlan_port !== undefined) {
      form.append('vxlan_port', String(req.vxlan_port));
    }
    if (req.filename && req.filename.trim().length > 0) {
      form.append('filename', req.filename.trim());
    }
    return apiClient.post<DecapsulateResponse>('/tools/decapsulate', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      // Decap is synchronous and may take a few seconds on big captures;
      // give the request plenty of headroom over the default 30s client
      // timeout.
      timeout: 120_000,
      onUploadProgress: (e) => {
        if (req.onProgress && e.total) {
          req.onProgress(Math.round((e.loaded * 100) / e.total));
        }
      },
    });
  },
};
