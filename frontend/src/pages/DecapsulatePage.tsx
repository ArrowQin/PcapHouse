import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Layers,
  Scissors,
  Loader2,
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  Upload,
  FileText,
  X,
} from 'lucide-react';
import { toolsApi, DecapsulateResponse } from '../api/tools';

/**
 * Strip outer Geneve / VXLAN layers from a user-supplied pcap.
 *
 * The source file is uploaded directly to the backend, processed in
 * memory, and then discarded — only the decapsulated output is
 * persisted (under the built-in "Decapsulated" category). This avoids
 * cluttering the library with the raw encapsulated capture, which is
 * typically only useful as an intermediate artifact.
 *
 * Inputs:
 *   - source file: chosen via file picker or drag-and-drop
 *   - toggles: strip Geneve (default on, port 6081) and strip VXLAN
 *     (default on, port 4789 — user-editable; e.g. 47896 for the
 *     bundled test capture).
 */

const ACCEPTED_EXTS = ['.pcap', '.pcapng', '.cap'];
// Keep in sync with backend _MAX_UPLOAD_BYTES in routers/tools.py.
const MAX_UPLOAD_MB = 512;

function hasAcceptedExt(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTS.some((ext) => lower.endsWith(ext));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DecapsulatePage: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Source file selection --------------------------------------------
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // ---- Tool parameters --------------------------------------------------
  const [stripGeneve, setStripGeneve] = useState(true);
  const [genevePort, setGenevePort] = useState<number>(6081);
  const [stripVxlan, setStripVxlan] = useState(true);
  const [vxlanPort, setVxlanPort] = useState<number>(4789);
  const [outFilename, setOutFilename] = useState<string>('');

  // ---- Run state --------------------------------------------------------
  const [running, setRunning] = useState(false);
  const [uploadPct, setUploadPct] = useState<number>(0);
  const [result, setResult] = useState<DecapsulateResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Auto-populate a sensible default output name whenever the user picks
  // a different source file (and hasn't already typed a custom name).
  useEffect(() => {
    if (!sourceFile) return;
    if (outFilename && outFilename.trim().length > 0) return;
    const base = sourceFile.name.replace(/\.(pcap|pcapng|cap)$/i, '');
    setOutFilename(`${base}.decap.pcap`);
    // We intentionally exclude outFilename from deps — only auto-fill
    // when the *source* changes, not when the user edits the filename.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFile]);

  const acceptFile = useCallback((f: File | null | undefined) => {
    if (!f) return;
    // Client-side validation mirrors the server's; both fail friendly
    // so the user sees the real reason either way.
    if (!hasAcceptedExt(f.name)) {
      setErrorMsg(
        `Unsupported file type "${f.name}". Expected one of: ${ACCEPTED_EXTS.join(', ')}.`,
      );
      return;
    }
    if (f.size === 0) {
      setErrorMsg('Selected file is empty.');
      return;
    }
    if (f.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setErrorMsg(`File is larger than the ${MAX_UPLOAD_MB} MB upload limit.`);
      return;
    }
    setErrorMsg(null);
    setResult(null);
    setSourceFile(f);
  }, []);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    acceptFile(f);
  };

  const canRun =
    !running &&
    sourceFile !== null &&
    (stripGeneve || stripVxlan) &&
    genevePort >= 1 &&
    genevePort <= 65535 &&
    vxlanPort >= 1 &&
    vxlanPort <= 65535;

  const handleRun = async () => {
    if (!canRun || !sourceFile) return;
    setRunning(true);
    setResult(null);
    setErrorMsg(null);
    setUploadPct(0);
    try {
      const res = await toolsApi.decapsulate({
        file: sourceFile,
        strip_geneve: stripGeneve,
        geneve_port: genevePort,
        strip_vxlan: stripVxlan,
        vxlan_port: vxlanPort,
        filename: outFilename.trim() || undefined,
        onProgress: setUploadPct,
      });
      setResult(res.data);
    } catch (err: unknown) {
      setErrorMsg(extractErrorMessage(err));
    } finally {
      setRunning(false);
    }
  };

  // Human-facing result summary line for the success card.
  const successLine = useMemo(() => {
    if (!result) return null;
    const s = result.stats;
    const stripped = s.stripped_both + s.stripped_geneve + s.stripped_vxlan;
    return `Decapsulated ${stripped}/${s.total} packet${s.total === 1 ? '' : 's'}`;
  }, [result]);

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Layers size={22} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Decapsulate</h1>
            <p className="text-xs text-muted">
              Strip outer Geneve (UDP 6081) and VXLAN (default UDP 4789)
              layers from a pcap, exposing the inner frame. Uploaded
              source files are processed in memory and
              <span className="text-muted font-medium"> not saved</span>;
              only the decapsulated output is added to the library.
            </p>
          </div>
        </div>
      </div>

      {/* 2-column layout */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* Left: Source file + action */}
        <div className="flex-[2] flex flex-col gap-5 min-w-0">
          {/* Dropzone / file picker */}
          <div className="p-4 bg-dark-700 border border-dark-600 rounded-xl flex flex-col gap-3 min-h-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileText size={16} className="text-primary" />
                Source pcap
              </h2>
              {sourceFile && (
                <button
                  onClick={() => {
                    setSourceFile(null);
                    setOutFilename('');
                    setResult(null);
                    setErrorMsg(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="text-[11px] text-muted-dark hover:text-red-400 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <X size={12} /> Clear
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_EXTS.join(',')}
              className="hidden"
              onChange={(e) => acceptFile(e.target.files?.[0])}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed cursor-pointer transition-all py-12 px-4 ${
                dragOver
                  ? 'border-primary/60 bg-primary/5'
                  : sourceFile
                  ? 'border-primary/40 bg-dark-600/40'
                  : 'border-dark-500 hover:border-primary/40 hover:bg-dark-600/40'
              }`}
            >
              {sourceFile ? (
                <>
                  <FileText size={28} className="text-primary" />
                  <div className="text-sm font-medium text-white truncate max-w-full px-4">
                    {sourceFile.name}
                  </div>
                  <div className="text-[11px] text-muted-dark font-mono">
                    {formatSize(sourceFile.size)}
                  </div>
                  <div className="text-[11px] text-muted-dark mt-1">
                    Click or drop to replace
                  </div>
                </>
              ) : (
                <>
                  <Upload size={28} className="text-muted-dark" />
                  <div className="text-sm text-white">
                    Drop a pcap here, or click to choose
                  </div>
                  <div className="text-[11px] text-muted-dark">
                    Accepts {ACCEPTED_EXTS.join(' / ')} · up to {MAX_UPLOAD_MB} MB
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Output filename + run button */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={outFilename}
              onChange={(e) => setOutFilename(e.target.value)}
              placeholder="output-filename.pcap (auto)"
              className="flex-1 px-4 py-2.5 bg-dark-600 border border-dark-500 rounded-xl
                         text-sm text-white font-mono placeholder-muted-dark/50
                         focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                         transition-colors"
            />
            <button
              onClick={handleRun}
              disabled={!canRun}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
                canRun
                  ? 'bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/25 cursor-pointer'
                  : 'bg-dark-500 text-muted-dark cursor-not-allowed'
              }`}
            >
              {running ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Scissors size={16} />
              )}
              {running
                ? uploadPct < 100
                  ? `Uploading ${uploadPct}%`
                  : 'Decapsulating…'
                : 'Decapsulate'}
            </button>
          </div>
        </div>

        {/* Right: parameters + result */}
        <div className="w-[340px] flex-shrink-0 flex flex-col gap-5 min-h-0">
          {/* Parameters panel */}
          <div className="p-4 bg-dark-700 border border-dark-600 rounded-xl space-y-4">
            <h3 className="text-xs font-semibold text-muted-dark uppercase tracking-wider">
              Layers to strip
            </h3>

            {/* Geneve */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={stripGeneve}
                  onChange={(e) => setStripGeneve(e.target.checked)}
                  className="accent-primary"
                />
                Strip Geneve
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-dark w-16">UDP port</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={genevePort}
                  disabled={!stripGeneve}
                  onChange={(e) => setGenevePort(parseInt(e.target.value, 10) || 0)}
                  className="flex-1 px-2 py-1 bg-dark-600 border border-dark-500 rounded
                             text-xs text-white font-mono
                             focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                             disabled:opacity-50"
                />
              </div>
            </div>

            {/* VXLAN */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={stripVxlan}
                  onChange={(e) => setStripVxlan(e.target.checked)}
                  className="accent-primary"
                />
                Strip VXLAN
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-dark w-16">UDP port</span>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={vxlanPort}
                  disabled={!stripVxlan}
                  onChange={(e) => setVxlanPort(parseInt(e.target.value, 10) || 0)}
                  className="flex-1 px-2 py-1 bg-dark-600 border border-dark-500 rounded
                             text-xs text-white font-mono
                             focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                             disabled:opacity-50"
                />
              </div>
              <p className="text-[10px] text-muted-dark leading-relaxed">
                Standard port is <span className="font-mono">4789</span>. Use a
                custom port if your captures were taken on a non-standard VXLAN
                deployment (e.g. <span className="font-mono">47896</span>).
              </p>
            </div>
          </div>

          {/* Result / error panel */}
          <div className="flex-1 flex flex-col min-h-0">
            <h3 className="text-xs font-semibold text-muted-dark uppercase tracking-wider mb-3">
              Result
            </h3>

            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400 flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                <div className="flex-1 break-words whitespace-pre-wrap">
                  <div className="font-medium text-red-300 mb-0.5">
                    Decapsulation failed
                  </div>
                  <div className="text-red-400/90">{errorMsg}</div>
                </div>
              </div>
            )}

            {result && !errorMsg && (
              <div className="p-3 bg-dark-700 border border-dark-600 rounded-xl space-y-3">
                <div className="flex items-center gap-2 text-sm text-green-400 font-medium">
                  <CheckCircle size={16} />
                  {successLine}
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-muted">
                  <span className="text-muted-dark">Both layers</span>
                  <span className="font-mono text-white text-right">
                    {result.stats.stripped_both}
                  </span>
                  <span className="text-muted-dark">Geneve only</span>
                  <span className="font-mono text-white text-right">
                    {result.stats.stripped_geneve}
                  </span>
                  <span className="text-muted-dark">VXLAN only</span>
                  <span className="font-mono text-white text-right">
                    {result.stats.stripped_vxlan}
                  </span>
                  <span className="text-muted-dark">Passthrough</span>
                  <span className="font-mono text-white text-right">
                    {result.stats.passthrough}
                  </span>
                  {result.stats.errors > 0 && (
                    <>
                      <span className="text-muted-dark">Errors</span>
                      <span className="font-mono text-red-400 text-right">
                        {result.stats.errors}
                      </span>
                    </>
                  )}
                </div>

                {result.stats.warnings.length > 0 && (
                  <div className="text-[11px] text-yellow-400/80 space-y-0.5">
                    {result.stats.warnings.map((w, i) => (
                      <div key={i}>⚠ {w}</div>
                    ))}
                  </div>
                )}

                <div className="pt-2 border-t border-dark-600 flex flex-col gap-1">
                  <div className="text-[11px] text-muted-dark truncate">
                    Saved as{' '}
                    <span className="font-mono text-white">{result.file.name}</span>
                  </div>
                  <button
                    onClick={() => navigate(`/pcap/${result.file.id}`)}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary-hover transition-colors cursor-pointer"
                  >
                    <ExternalLink size={12} />
                    Open in Pcap Viewer
                  </button>
                </div>
              </div>
            )}

            {!result && !errorMsg && (
              <div className="text-center py-8 text-muted-dark text-sm border border-dashed border-dark-600 rounded-xl">
                Pick a source pcap and click
                <span className="font-medium text-muted"> Decapsulate</span>.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Best-effort extraction of a human-readable error message from an
 * Axios / fetch / generic Error. FastAPI puts its message in
 * ``response.data.detail``, which can be either a plain string (our
 * HTTPException path) or a list of validation objects (Pydantic 422).
 */
function extractErrorMessage(err: unknown): string {
  if (!err) return 'Decapsulation failed';

  // Axios-style error
  const anyErr = err as {
    response?: { status?: number; data?: unknown };
    message?: string;
  };
  const data = anyErr.response?.data;

  if (typeof data === 'string' && data.trim().length > 0) {
    return data;
  }
  if (data && typeof data === 'object') {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim().length > 0) {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      // Pydantic validation error list: join each entry's msg.
      return detail
        .map((d) => {
          if (typeof d === 'string') return d;
          if (d && typeof d === 'object') {
            const msg = (d as { msg?: unknown }).msg;
            const loc = (d as { loc?: unknown }).loc;
            const locStr = Array.isArray(loc) ? loc.join('.') : '';
            return locStr ? `${locStr}: ${String(msg ?? '')}` : String(msg ?? '');
          }
          return String(d);
        })
        .filter(Boolean)
        .join('; ');
    }
    const msg = (data as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim().length > 0) {
      return msg;
    }
  }

  if (anyErr.response?.status) {
    return `${anyErr.message || 'Request failed'} (HTTP ${anyErr.response.status})`;
  }
  return anyErr.message || 'Decapsulation failed';
}

export default DecapsulatePage;
