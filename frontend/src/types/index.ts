// ===== File Types =====
export interface FileCategoryRef {
  id: number;
  name: string;
}

export interface PcapFile {
  id: number;
  uuid: string;
  name: string;
  size: number;
  category_id: number | null;
  category: FileCategoryRef | null;
  upload_time: string;
  protocol_summary: string;
  file_path: string;
  is_favorite: boolean;
  note: string;
  tags: Tag[];
}

export interface FileListResponse {
  files: PcapFile[];
  total: number;
  page: number;
  page_size: number;
}

// ===== Category Types =====
export interface Category {
  id: number;
  name: string;
  description: string;
  is_builtin?: boolean;
  file_count: number;
  created_at: string;
}

// ===== Tag Types =====
export interface Tag {
  id: number;
  name: string;
  color: string;
}

// ===== Activity Types =====
export interface Activity {
  id: number;
  action: string;
  file_name: string | null;
  description: string;
  created_at: string;
}

// ===== Pcap Viewer Types =====
export interface PcapFrame {
  number: number;
  time: string;
  source: string;
  destination: string;
  protocol: string;
  length: number;
  info: string;
}

export interface ProtocolNode {
  label: string;
  field: string;
  value: string;
  children?: ProtocolNode[];
}

export interface FrameDetail {
  number: number;
  protocols: ProtocolNode[];
}

export interface HexDumpData {
  offset: string[];
  hex: string[];
  ascii: string[];
}

// ===== Storage Types =====
export interface StorageInfo {
  total_files: number;
  total_size: number;
  total_categories: number;
  total_tags: number;
}

// ===== Search Types =====
export interface SearchParams {
  q?: string;
  category_id?: number;
  category_ids?: number[];
  tag_ids?: number[];
  protocols?: string[];
  file_type?: string;
  is_favorite?: boolean;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  page?: number;
  page_size?: number;
}

// ===== UI Types =====
export type ViewMode = 'grid' | 'list';

export interface SidebarItem {
  key: string;
  label: string;
  icon: string;
  path: string;
  badge?: number;
}

// ===== Generator Types =====
export interface GenerateRequest {
  protocol: string;
  raw_request: string;
  raw_response: string;
  src_ip: string;
  dst_ip: string;
  port: number;
  /** Explicit source (client) port. null / undefined = auto-assign. */
  src_port?: number | null;
  /** Explicit destination (server) port. Falls back to `port` when omitted. */
  dst_port?: number | null;
  filename?: string;
  category_id?: number | null;
  tag_ids?: number[];
}

export interface GenerateTask {
  id: number;
  uuid: string;
  protocol: string;
  status: 'pending' | 'parsing' | 'capturing' | 'processing' | 'saving' | 'success' | 'failed';
  src_ip: string;
  dst_ip: string;
  port: number;
  src_port: number | null;
  dst_port: number | null;
  filename: string | null;
  file_id: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface SupportedProtocol {
  name: string;
  label: string;
  description: string;
  available: boolean;
}
