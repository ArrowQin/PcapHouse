import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Cloud,
  Save,
  PlugZap,
  PlayCircle,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Eye,
  EyeOff,
  History,
} from 'lucide-react';
import PageHeader from '../components/common/PageHeader';
import {
  backupApi,
  BackupConfig,
  BackupConfigUpdate,
  BackupRecord,
  BackupRunResult,
} from '../api/backup';

/**
 * Backup & restore settings page — Tencent Cloud COS.
 *
 * The form binds to a local "draft" copy of the config so the user can
 * edit multiple fields before hitting Save; secrets are write-only
 * (masked on read, type=password on edit) and are only sent to the
 * backend when the user explicitly types into the field — that's what
 * the ``secretIdDirty`` / ``secretKeyDirty`` flags track. Without this,
 * re-saving the form would clobber a real secret with the masked
 * placeholder.
 */

interface Draft {
  bucket: string;
  region: string;
  secret_id: string;
  secret_key: string;
  path_prefix: string;
  enabled: boolean;
  schedule_time: string;
}

const emptyDraft: Draft = {
  bucket: '',
  region: '',
  secret_id: '',
  secret_key: '',
  path_prefix: '',
  enabled: false,
  schedule_time: '03:00',
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

const statusStyles: Record<BackupRunResult['status'], string> = {
  success: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  failed: 'text-rose-400 bg-rose-500/10 border-rose-500/25',
};

const statusIcon = (status: BackupRunResult['status']) => {
  switch (status) {
    case 'success':
      return <CheckCircle2 size={14} />;
    case 'failed':
      return <AlertTriangle size={14} />;
  }
};

const BackupPage: React.FC = () => {
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  // Secrets are a special case: the backend returns masked strings on
  // GET, so we can't use that as the baseline for dirty-detection. We
  // track an explicit "did the user type into this field?" bit; only
  // when true do we include the secret in the PUT payload.
  const [secretIdDirty, setSecretIdDirty] = useState(false);
  const [secretKeyDirty, setSecretKeyDirty] = useState(false);
  const [showSecretId, setShowSecretId] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [running, setRunning] = useState(false);
  const [inlineResult, setInlineResult] = useState<BackupRunResult | null>(null);
  const [history, setHistory] = useState<BackupRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const applyConfigToDraft = useCallback((cfg: BackupConfig) => {
    // Secrets aren't returned in clear — so the draft's secret fields
    // start empty and we rely on ``has_secret_id`` / ``has_secret_key``
    // to show the "already configured" placeholder in the input.
    setDraft({
      bucket: cfg.bucket,
      region: cfg.region,
      secret_id: '',
      secret_key: '',
      path_prefix: cfg.path_prefix,
      enabled: cfg.enabled,
      schedule_time: cfg.schedule_time,
    });
    setSecretIdDirty(false);
    setSecretKeyDirty(false);
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await backupApi.getConfig();
      setConfig(res.data);
      applyConfigToDraft(res.data);
    } finally {
      setLoading(false);
    }
  }, [applyConfigToDraft]);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await backupApi.getHistory(20);
      setHistory(res.data);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadHistory();
  }, [loadConfig, loadHistory]);

  // "Dirty" when any non-secret field diverges from the baseline OR
  // when a secret field has been explicitly typed into. We intentionally
  // DO NOT mark secrets dirty just because their bound value is a
  // non-empty string — the user might have pasted and then deleted,
  // leaving an empty string that shouldn't round-trip.
  const dirty = useMemo(() => {
    if (!config) return false;
    if (secretIdDirty || secretKeyDirty) return true;
    return (
      draft.bucket !== config.bucket ||
      draft.region !== config.region ||
      draft.path_prefix !== config.path_prefix ||
      draft.enabled !== config.enabled ||
      draft.schedule_time !== config.schedule_time
    );
  }, [config, draft, secretIdDirty, secretKeyDirty]);

  const buildPayload = (): BackupConfigUpdate => {
    const p: BackupConfigUpdate = {
      bucket: draft.bucket.trim(),
      region: draft.region.trim(),
      path_prefix: draft.path_prefix.trim(),
      enabled: draft.enabled,
      schedule_time: draft.schedule_time,
    };
    if (secretIdDirty) p.secret_id = draft.secret_id;
    if (secretKeyDirty) p.secret_key = draft.secret_key;
    return p;
  };

  const save = async () => {
    setSaving(true);
    setInlineResult(null);
    try {
      const res = await backupApi.updateConfig(buildPayload());
      setConfig(res.data);
      applyConfigToDraft(res.data);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    // Save first if there are pending edits — testing against stale
    // server-side credentials is almost never what the user wants.
    setTesting(true);
    setInlineResult(null);
    try {
      if (dirty) {
        const res = await backupApi.updateConfig(buildPayload());
        setConfig(res.data);
        applyConfigToDraft(res.data);
      }
      const res = await backupApi.testConnection();
      setInlineResult(res.data);
    } finally {
      setTesting(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    setInlineResult(null);
    try {
      if (dirty) {
        const res = await backupApi.updateConfig(buildPayload());
        setConfig(res.data);
        applyConfigToDraft(res.data);
      }
      const res = await backupApi.runNow();
      setInlineResult(res.data);
      // The new record will land at the top of the history.
      loadHistory();
      // The "last run" denorm fields on the config also just changed.
      loadConfig();
    } finally {
      setRunning(false);
    }
  };

  // Placeholder shown inside the secret inputs when the backend already
  // has a value and the user hasn't typed anything yet. Using the
  // masked string directly makes it obvious "something is saved" while
  // still letting the user overwrite by typing.
  const secretIdPlaceholder = config?.has_secret_id
    ? config.secret_id_masked
    : 'AKID…';
  const secretKeyPlaceholder = config?.has_secret_key
    ? config.secret_key_masked
    : 'SecretKey';

  return (
    <div className="h-full overflow-y-auto pr-1 flex flex-col">
      <PageHeader
        icon={<Cloud size={24} className="text-primary" />}
        title="Cloud Backup"
        description="Configure scheduled backups of the PcapHouse database and uploaded pcap files to a Tencent Cloud COS bucket."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={testConnection}
              disabled={testing || saving || running || loading}
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
              onClick={runNow}
              disabled={running || saving || testing || loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-muted hover:text-white hover:bg-dark-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Run a backup right now"
            >
              {running ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <PlayCircle size={14} />
              )}
              Backup now
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

      {/* Inline result banner for Test / Backup Now. Hidden on page load;
          appears after an action completes and stays until the next one. */}
      {inlineResult && (
        <div
          className={`mb-4 flex items-start gap-2 p-3 rounded-lg border text-xs ${
            statusStyles[inlineResult.status]
          }`}
        >
          <span className="flex-shrink-0 mt-0.5">
            {statusIcon(inlineResult.status)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-medium capitalize">
              {inlineResult.status}
            </div>
            <div className="opacity-90 break-words">{inlineResult.message}</div>
            {inlineResult.object_key && (
              <div className="opacity-70 mt-1 font-mono text-[11px] truncate">
                {inlineResult.object_key} ({formatBytes(inlineResult.size_bytes)})
              </div>
            )}
          </div>
        </div>
      )}

      {/* Two-column layout on wide screens: form on the left, status +
          history on the right. Collapses to a single column below md. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* --- Form --- */}
        <section className="lg:col-span-2 rounded-xl bg-dark-700 border border-dark-600 p-4">
          <h2 className="text-sm font-semibold text-white mb-1">
            COS credentials
          </h2>
          <p className="text-xs text-muted-dark mb-4">
            Create a sub-account in{' '}
            <a
              href="https://console.cloud.tencent.com/cam"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              CAM
            </a>{' '}
            with the{' '}
            <code className="px-1 py-0.5 rounded bg-dark-800 text-[11px]">
              QcloudCOSDataFullControl
            </code>{' '}
            policy scoped to the target bucket. Secrets are stored locally
            on the server and never echoed back to the browser once saved.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Bucket">
              <input
                type="text"
                placeholder="my-backups-1250000000"
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
                  title={showSecretId ? 'Hide' : 'Show'}
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
                  title={showSecretKey ? 'Hide' : 'Show'}
                >
                  {showSecretKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </Field>

            <Field
              label="Object key prefix"
              hint="Optional folder inside the bucket. Leave empty to store at the bucket root."
              className="md:col-span-2"
            >
              <input
                type="text"
                placeholder="pcaphouse/prod"
                value={draft.path_prefix}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, path_prefix: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-600 text-sm text-white placeholder:text-muted-dark focus:border-primary focus:outline-none transition-colors font-mono"
              />
            </Field>
          </div>

          <h2 className="text-sm font-semibold text-white mt-6 mb-3">
            Schedule
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field
              label="Enable scheduled backups"
              hint="When off, backups only run when you click “Backup now”."
            >
              <Toggle
                checked={draft.enabled}
                onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))}
              />
            </Field>
            <Field
              label="Daily run time"
              hint="Interpreted in the server's local time zone."
            >
              <input
                type="time"
                value={draft.schedule_time}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, schedule_time: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg bg-dark-800 border border-dark-600 text-sm text-white focus:border-primary focus:outline-none transition-colors font-mono"
              />
            </Field>
          </div>
        </section>

        {/* --- Status + history --- */}
        <section className="space-y-4">
          <div className="rounded-xl bg-dark-700 border border-dark-600 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white">Last run</h2>
              {/* Prominent "run immediately" affordance. The same action
                  also lives in the page header, but having it right next
                  to the Last-run panel matches the mental model of "I
                  want to trigger another one now". Disabled until the
                  config has the minimum required fields so users don't
                  fire a run that's guaranteed to fail. */}
              <button
                onClick={runNow}
                disabled={
                  running ||
                  saving ||
                  testing ||
                  loading ||
                  !draft.bucket.trim() ||
                  !draft.region.trim() ||
                  (!config?.has_secret_id && !secretIdDirty) ||
                  (!config?.has_secret_key && !secretKeyDirty)
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Run a backup right now"
              >
                {running ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <PlayCircle size={12} />
                )}
                {running ? 'Running…' : 'Run backup now'}
              </button>
            </div>
            {config?.last_run_at ? (
              <div className="space-y-2 text-xs">
                <Row label="Status">
                  {config.last_status ? (
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${
                        statusStyles[
                          config.last_status as BackupRunResult['status']
                        ] ?? ''
                      }`}
                    >
                      {statusIcon(
                        config.last_status as BackupRunResult['status']
                      )}
                      <span className="capitalize">{config.last_status}</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </Row>
                <Row label="When">{formatDateTime(config.last_run_at)}</Row>
                <Row label="Size">{formatBytes(config.last_size_bytes)}</Row>
                {config.last_object_key && (
                  <Row label="Object">
                    <span className="font-mono text-[11px] break-all">
                      {config.last_object_key}
                    </span>
                  </Row>
                )}
                {config.last_message && (
                  <Row label="Message">
                    <span className="opacity-80 break-words">
                      {config.last_message}
                    </span>
                  </Row>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-dark">No backup runs yet.</p>
            )}
          </div>

          <div className="rounded-xl bg-dark-700 border border-dark-600 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-white inline-flex items-center gap-1.5">
                <History size={14} />
                History
              </h2>
              <button
                onClick={loadHistory}
                disabled={loadingHistory}
                className="p-1.5 rounded text-muted-dark hover:text-white hover:bg-dark-600 transition-colors disabled:opacity-40"
                title="Refresh history"
              >
                <RefreshCw
                  size={12}
                  className={loadingHistory ? 'animate-spin' : ''}
                />
              </button>
            </div>
            {history.length === 0 ? (
              <p className="text-xs text-muted-dark text-center py-4">
                No records yet.
              </p>
            ) : (
              <ul className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {history.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-dark-600 bg-dark-800 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                          statusStyles[r.status] ?? ''
                        }`}
                      >
                        {statusIcon(r.status)}
                        <span className="capitalize">{r.status}</span>
                      </span>
                      <span className="text-muted-dark text-[11px]">
                        {r.trigger}
                      </span>
                    </div>
                    <div className="mt-1 text-muted-dark text-[11px]">
                      {formatDateTime(r.created_at)}
                      {r.size_bytes != null && ` · ${formatBytes(r.size_bytes)}`}
                      {r.duration_ms != null &&
                        ` · ${(r.duration_ms / 1000).toFixed(1)}s`}
                    </div>
                    {r.object_key && (
                      <div className="mt-1 font-mono text-[10px] text-muted-dark break-all">
                        {r.object_key}
                      </div>
                    )}
                    {r.message && r.status !== 'success' && (
                      <div className="mt-1 text-[11px] opacity-80 break-words">
                        {r.message}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

// ---------- small presentational helpers (kept local to the page) ----------

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

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
      checked ? 'bg-primary' : 'bg-dark-600'
    }`}
    role="switch"
    aria-checked={checked}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex items-start gap-2">
    <span className="text-muted-dark w-16 flex-shrink-0">{label}</span>
    <span className="text-white min-w-0 flex-1">{children}</span>
  </div>
);

export default BackupPage;
