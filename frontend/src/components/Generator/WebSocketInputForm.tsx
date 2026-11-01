import React from 'react';
import { Plus, Trash2, ArrowRight, ArrowLeft } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types (exported for consumers)
// ---------------------------------------------------------------------------

export type WsFrameDirection = 'c2s' | 's2c';
export type WsFrameType = 'text' | 'binary';

export interface WsFrame {
  direction: WsFrameDirection;
  type: WsFrameType;
  /** text: plain UTF-8 string; binary: hex string (e.g. "48656c6c6f") */
  data: string;
}

export interface WsHeader {
  key: string;
  value: string;
}

export interface WebSocketConfig {
  path: string;
  host: string;
  origin: string;
  extraHeaders: WsHeader[];
  frames: WsFrame[];
}

// ---------------------------------------------------------------------------
// Serializer consumed by GeneratorPage when building the submit payload
// ---------------------------------------------------------------------------

export function buildWebSocketRawRequest(cfg: WebSocketConfig): string {
  const payload = {
    path: cfg.path.trim() || '/',
    host: cfg.host.trim(),
    origin: cfg.origin.trim(),
    extra_headers: cfg.extraHeaders
      .map((h) => ({ key: h.key.trim(), value: h.value }))
      .filter((h) => h.key.length > 0),
    frames: cfg.frames.map((f) => ({
      direction: f.direction,
      type: f.type,
      data: f.data,
    })),
  };
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  config: WebSocketConfig;
  onChange: (cfg: WebSocketConfig) => void;
}

const FRAME_PLACEHOLDERS: Record<WsFrameType, string> = {
  text: 'Hello, WebSocket!',
  binary: '48656c6c6f (hex)',
};

const WebSocketInputForm: React.FC<Props> = ({ config, onChange }) => {
  const patch = (p: Partial<WebSocketConfig>) => onChange({ ...config, ...p });

  // -- Extra Headers --
  const addHeader = () =>
    patch({ extraHeaders: [...config.extraHeaders, { key: '', value: '' }] });
  const updateHeader = (idx: number, p: Partial<WsHeader>) =>
    patch({
      extraHeaders: config.extraHeaders.map((h, i) =>
        i === idx ? { ...h, ...p } : h
      ),
    });
  const removeHeader = (idx: number) =>
    patch({ extraHeaders: config.extraHeaders.filter((_, i) => i !== idx) });

  // -- Frames --
  const addFrame = () =>
    patch({
      frames: [
        ...config.frames,
        { direction: 'c2s', type: 'text', data: '' },
      ],
    });
  const updateFrame = (idx: number, p: Partial<WsFrame>) =>
    patch({
      frames: config.frames.map((f, i) => (i === idx ? { ...f, ...p } : f)),
    });
  const removeFrame = (idx: number) =>
    patch({ frames: config.frames.filter((_, i) => i !== idx) });

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* ---------------- Handshake ---------------- */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-muted-dark uppercase tracking-wider">
          Upgrade Handshake
        </h3>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted mb-1 block">Path</label>
            <input
              type="text"
              value={config.path}
              onChange={(e) => patch({ path: e.target.value })}
              placeholder="/ws/chat"
              className="w-full px-3 py-2 bg-dark-600 border border-dark-500 rounded-lg
                       text-sm text-white font-mono placeholder-muted-dark/50
                       focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       transition-colors"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Host</label>
            <input
              type="text"
              value={config.host}
              onChange={(e) => patch({ host: e.target.value })}
              placeholder="example.com"
              className="w-full px-3 py-2 bg-dark-600 border border-dark-500 rounded-lg
                       text-sm text-white font-mono placeholder-muted-dark/50
                       focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       transition-colors"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Origin</label>
            <input
              type="text"
              value={config.origin}
              onChange={(e) => patch({ origin: e.target.value })}
              placeholder="https://example.com"
              className="w-full px-3 py-2 bg-dark-600 border border-dark-500 rounded-lg
                       text-sm text-white font-mono placeholder-muted-dark/50
                       focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       transition-colors"
              spellCheck={false}
            />
          </div>
        </div>
      </div>

      {/* ---------------- Extra Headers ---------------- */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted-dark uppercase tracking-wider">
            Extra Headers
          </h3>
          <button
            onClick={addHeader}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium
                     text-primary hover:bg-primary/10 transition-colors cursor-pointer"
          >
            <Plus size={14} />
            Add Header
          </button>
        </div>

        {config.extraHeaders.length === 0 ? (
          <div className="text-center py-3 text-muted-dark text-xs border border-dashed border-dark-500 rounded-xl">
            No extra headers.
          </div>
        ) : (
          <div className="space-y-2">
            {config.extraHeaders.map((h, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 bg-dark-600 border border-dark-500 rounded-xl group"
              >
                <input
                  type="text"
                  value={h.key}
                  onChange={(e) => updateHeader(idx, { key: e.target.value })}
                  placeholder="X-Custom-Header"
                  className="w-[32%] px-3 py-1.5 bg-dark-700 border border-dark-500 rounded-lg
                           text-xs text-white font-mono placeholder-muted-dark/50
                           focus:outline-none focus:border-primary/50 transition-colors"
                  spellCheck={false}
                />
                <input
                  type="text"
                  value={h.value}
                  onChange={(e) =>
                    updateHeader(idx, { value: e.target.value })
                  }
                  placeholder="value"
                  className="flex-1 px-3 py-1.5 bg-dark-700 border border-dark-500 rounded-lg
                           text-xs text-white font-mono placeholder-muted-dark/50
                           focus:outline-none focus:border-primary/50 transition-colors"
                  spellCheck={false}
                />
                <button
                  onClick={() => removeHeader(idx)}
                  className="p-1.5 rounded-lg text-muted-dark hover:text-red-400 hover:bg-red-400/10
                           opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  title="Remove header"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------------- Frames ---------------- */}
      <div className="flex flex-col gap-2 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted-dark uppercase tracking-wider">
            Frames Timeline
          </h3>
          <button
            onClick={addFrame}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium
                     text-primary hover:bg-primary/10 transition-colors cursor-pointer"
          >
            <Plus size={14} />
            Add Frame
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {config.frames.length === 0 ? (
            <div className="text-center py-8 text-muted-dark text-sm border border-dashed border-dark-500 rounded-xl">
              No frames yet.
              <br />
              Click "Add Frame" to start scripting the WebSocket session.
            </div>
          ) : (
            config.frames.map((f, idx) => {
              const isC2S = f.direction === 'c2s';
              const accent = isC2S ? 'bg-primary' : 'bg-emerald-400';
              return (
                <div
                  key={idx}
                  className="flex items-stretch gap-2 p-2.5 bg-dark-600 border border-dark-500 rounded-xl group"
                >
                  {/* Direction accent bar */}
                  <div className={`w-0.5 rounded-full ${accent}`} />

                  {/* Direction select */}
                  <div className="w-[118px]">
                    <select
                      value={f.direction}
                      onChange={(e) =>
                        updateFrame(idx, {
                          direction: e.target.value as WsFrameDirection,
                        })
                      }
                      className="w-full h-full px-2 py-1.5 bg-dark-700 border border-dark-500 rounded-lg
                               text-xs text-white
                               focus:outline-none focus:border-primary/50
                               transition-colors appearance-none cursor-pointer"
                    >
                      <option value="c2s">client → server</option>
                      <option value="s2c">server → client</option>
                    </select>
                  </div>

                  {/* Direction icon */}
                  <div
                    className={`flex items-center px-1 ${
                      isC2S ? 'text-primary' : 'text-emerald-400'
                    }`}
                  >
                    {isC2S ? (
                      <ArrowRight size={14} />
                    ) : (
                      <ArrowLeft size={14} />
                    )}
                  </div>

                  {/* Type select */}
                  <div className="w-[90px]">
                    <select
                      value={f.type}
                      onChange={(e) =>
                        updateFrame(idx, {
                          type: e.target.value as WsFrameType,
                        })
                      }
                      className="w-full h-full px-2 py-1.5 bg-dark-700 border border-dark-500 rounded-lg
                               text-xs text-white
                               focus:outline-none focus:border-primary/50
                               transition-colors appearance-none cursor-pointer"
                    >
                      <option value="text">text</option>
                      <option value="binary">binary</option>
                    </select>
                  </div>

                  {/* Data input */}
                  <input
                    type="text"
                    value={f.data}
                    onChange={(e) =>
                      updateFrame(idx, { data: e.target.value })
                    }
                    placeholder={FRAME_PLACEHOLDERS[f.type]}
                    className="flex-1 px-3 py-1.5 bg-dark-700 border border-dark-500 rounded-lg
                             text-xs text-white font-mono placeholder-muted-dark/50
                             focus:outline-none focus:border-primary/50 transition-colors"
                    spellCheck={false}
                  />

                  {/* Delete */}
                  <button
                    onClick={() => removeFrame(idx)}
                    className="p-1.5 rounded-lg text-muted-dark hover:text-red-400 hover:bg-red-400/10
                             opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                    title="Remove frame"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default WebSocketInputForm;
