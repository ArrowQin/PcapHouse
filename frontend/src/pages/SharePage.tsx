import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Share2,
  Save,
  PlugZap,
  Loader2,
  Trash2,
  ExternalLink,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  FileText,
} from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import {
  shareApi,
  ShareConfig,
  ShareConfigUpdate,
  SharedFile,
} from '../api/share';

interface Draft {
  bucket: string;
  region: string;
  secret_id: string;
  secret_key: string;
  path_prefix: string;
}

const emptyDraft: Draft = {
  bucket: '',
  region: '',
  secret_id: '',
  secret_key: '',
  path_prefix: '',
};

function formatBytes(n: number | null | undefined): string {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)} ${units[i]}`;
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

const SharePage: React.FC = () => {
  const [config, setConfig] = useState<ShareConfig | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [secretIdDirty, setSecretIdDirty] = useState(false);
  const [secretKeyDirty, setSecretKeyDirty] = useState(false);
  const [showSecretId, setShowSecretId] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: string;
    message: string;
  } | null>(null);

  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const applyConfigToDraft = useCallback((cfg: ShareConfig) => {
    setDraft({
      bucket: cfg.bucket,
      region: cfg.region,
      secret_id: '',
      secret_key: '',
      path_prefix: cfg.path_prefix,
    });
    setSecretIdDirty(false);
    setSecretKeyDirty(false);
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await shareApi.getConfig();
      setConfig(res.data);
      applyConfigToDraft(res.data);
    } finally {
      setLoading(false);
    }
  }, [applyConfigToDraft]);

  const loadSharedFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await shareApi.listSharedFiles();
      setSharedFiles(res.data);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadSharedFiles();
  }, [loadConfig, loadSharedFiles]);

  const dirty = useMemo(() => {
    if (!config) return false;
    if (secretIdDirty || secretKeyDirty) return true;
    return (
      draft.bucket !== config.bucket ||
      draft.region !== config.region ||
      draft.path_prefix !== config.path_prefix
    );
  }, [config, draft, secretIdDirty, secretKeyDirty]);

  const buildPayload = (): ShareConfigUpdate => {
    const p: ShareConfigUpdate = {
      bucket: draft.bucket.trim(),
      region: draft.region.trim(),
      path_prefix: draft.path_prefix.trim(),
    };
    if (secretIdDirty) p.secret_id = draft.secret_id;
    if (secretKeyDirty) p.secret_key = draft.secret_key;
    return p;
  };

  const save = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const res = await shareApi.updateConfig(buildPayload());
      setConfig(res.data);
      applyConfigToDraft(res.data);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      if (dirty) {
        const res = await shareApi.updateConfig(buildPayload());
        setConfig(res.data);
        applyConfigToDraft(res.data);
      }
      const res = await shareApi.testConnection();
      setTestResult(res.data);
    } finally {
      setTesting(false);
    }
  };

  const handleUnshare = async (shareId: number) => {
    setDeletingIds((s) => new Set(s).add(shareId));
    try {
      await shareApi.unshareFile(shareId);
      setSharedFiles((prev) => prev.filter((f) => f.id !== shareId));
    } catch (e) {
      console.error('Failed to unshare:', e);
    } finally {
      setDeletingIds((s) => {
        const next = new Set(s);
        next.delete(shareId);
        return next;
      });
    }
  };

  const copyToClipboard = async (url: string, id: number) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const secretIdPlaceholder = config?.has_secret_id
    ? config.secret_id_masked
    : 'AKID…';
  const secretKeyPlaceholder = config?.has_secret_key
    ? config.secret_key_masked
    : 'SecretKey';

  return (
    <div className="h-full overflow-y-auto pr-1 flex flex-col">
      <PageHeader
        icon={<Share2 size={24} className="text-primary" />}
        title="Share Files"
        description="Share pcap files via Tencent Cloud COS public links. Manage shared files and COS credentials below."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={testConnection}
              disabled={testing || saving || loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-muted hover:text-white hover:bg-dark-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <PlugZap size={14} />
              )}
              Test connection
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving || loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        }
      />

      {/* Test result banner */}
      {testResult && (
        <div
          className={`mb-4 flex items-start gap-2 p-3 rounded-lg border text-xs ${
            testResult.status === 'success'
              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
              : 'text-rose-400 bg-rose-500/10 border-rose-500/25'
          }`}
        >
          <span className="flex-shrink-0 mt-0.5">
            {testResult.status === 'success' ? (
              <CheckCircle2 size={14} />
            ) : (
              <AlertTriangle size={14} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium capitalize">{testResult.status}</div>
            <div className="opacity-90 break-words">{testResult.message}</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* --- Config Form --- */}
        <section className="rounded-xl bg-dark-700 border border-dark-600 p-4">
          <h2 className="text-sm font-semibold text-white mb-1">
            Share COS Credentials
          </h2>
          <p className="text-xs text-muted-dark mb-4">
            Configure a dedicated COS bucket for sharing files publicly.
            The bucket should have <strong>public-read</strong> access so
            shared links are accessible without signing.
          </p>

          <div className="space-y-3">
            <Field label="Bucket">
              <input
                type="text"
                placeholder="my-share-1250000000"
                value={draft.bucket}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, bucket: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-600 text-sm text-white placeholder:text-muted-dark focus:border-primary focus:outline-none transition-colors"
              />
            </Field>
            <Field label="Region">
              <input
                type="text"
                placeholder="ap-guangzhou"
                value={draft.region}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, region: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-600 text-sm text-white placeholder:text-muted-dark focus:border-primary focus:outline-none transition-colors"
              />
            </Field>

            <Field label="SecretId">
              <div className="relative">
                <input
                  type={showSecretId ? 'text' : 'password'}
                  placeholder={secretIdPlaceholder}
                  value={draft.secret_id}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, secret_id: e.target.value }));
                    setSecretIdDirty(true);
                  }}
                  className="w-full pl-3 pr-9 py-2 rounded-lg bg-dark-800 border border-dark-600 text-sm text-white placeholder:text-muted-dark focus:border-primary focus:outline-none transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowSecretId((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-dark hover:text-white"
                >
                  {showSecretId ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>
            <Field label="SecretKey">
              <div className="relative">
                <input
                  type={showSecretKey ? 'text' : 'password'}
                  placeholder={secretKeyPlaceholder}
                  value={draft.secret_key}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, secret_key: e.target.value }));
                    setSecretKeyDirty(true);
                  }}
                  className="w-full pl-3 pr-9 py-2 rounded-lg bg-dark-800 border border-dark-600 text-sm text-white placeholder:text-muted-dark focus:border-primary focus:outline-none transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowSecretKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-dark hover:text-white"
                >
                  {showSecretKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>

            <Field
              label="Object key prefix"
              hint="Optional folder inside the bucket."
            >
              <input
                type="text"
                placeholder="shared"
                value={draft.path_prefix}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, path_prefix: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-600 text-sm text-white placeholder:text-muted-dark focus:border-primary focus:outline-none transition-colors font-mono"
              />
            </Field>
          </div>
        </section>

        {/* --- Shared Files List --- */}
        <section className="lg:col-span-2 rounded-xl bg-dark-700 border border-dark-600 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white inline-flex items-center gap-1.5">
              <FileText size={14} />
              Shared Files
              {sharedFiles.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[11px]">
                  {sharedFiles.length}
                </span>
              )}
            </h2>
            <button
              onClick={loadSharedFiles}
              disabled={loadingFiles}
              className="text-xs text-muted-dark hover:text-white transition-colors disabled:opacity-40"
            >
              {loadingFiles ? 'Loading…' : 'Refresh'}
            </button>
          </div>

          {sharedFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Share2 size={40} className="text-muted-dark mb-3" />
              <p className="text-sm text-muted-dark">
                No files shared yet.
              </p>
              <p className="text-xs text-muted-dark mt-1">
                Use the share button on the Files page to share pcap files via COS.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
              {sharedFiles.map((file) => (
                <div
                  key={file.id}
                  className="rounded-lg border border-dark-600 bg-dark-800 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-white truncate">
                          {file.file_name}
                        </span>
                        <span className="text-[11px] text-muted-dark flex-shrink-0">
                          {formatBytes(file.size_bytes)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 group">
                        <a
                          href={file.cos_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline truncate max-w-[500px] font-mono"
                          title={file.cos_url}
                        >
                          {file.cos_url}
                        </a>
                        <button
                          onClick={() => copyToClipboard(file.cos_url, file.id)}
                          className="flex-shrink-0 p-1 rounded text-muted-dark hover:text-white hover:bg-dark-600 transition-colors"
                          title="Copy URL"
                        >
                          {copiedId === file.id ? (
                            <CheckCircle2
                              size={12}
                              className="text-emerald-400"
                            />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                        <a
                          href={file.cos_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-shrink-0 p-1 rounded text-muted-dark hover:text-white hover:bg-dark-600 transition-colors"
                          title="Open in new tab"
                        >
                          <ExternalLink size={12} />
                        </a>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-dark">
                        Shared {formatDateTime(file.shared_at)}
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnshare(file.id)}
                      disabled={deletingIds.has(file.id)}
                      className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-rose-400 hover:bg-rose-500/10 border border-rose-500/25 hover:border-rose-500/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Cancel share & delete from COS"
                    >
                      {deletingIds.has(file.id) ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                      {deletingIds.has(file.id) ? 'Deleting…' : 'Cancel share'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

// ---------- small presentational helpers ----------

interface FieldProps {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

const Field: React.FC<FieldProps> = ({ label, hint, className, children }) => (
  <div className={className}>
    <label className="block text-xs font-medium text-muted mb-1">
      {label}
    </label>
    {children}
    {hint && <p className="mt-1 text-[11px] text-muted-dark">{hint}</p>}
  </div>
);

export default SharePage;
