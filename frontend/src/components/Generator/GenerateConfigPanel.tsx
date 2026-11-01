import React from 'react';

interface GenerateConfigPanelProps {
  srcIp: string;
  onSrcIpChange: (v: string) => void;
  dstIp: string;
  onDstIpChange: (v: string) => void;
  port: number;
  onPortChange: (v: number) => void;
  /** Optional pinned source port. Empty string = auto. */
  srcPort: string;
  onSrcPortChange: (v: string) => void;
}

const GenerateConfigPanel: React.FC<GenerateConfigPanelProps> = ({
  srcIp, onSrcIpChange,
  dstIp, onDstIpChange,
  port, onPortChange,
  srcPort, onSrcPortChange,
}) => {
  return (
    <div className="space-y-6">
      {/* Network Config */}
      <div>
        <h3 className="text-xs font-semibold text-muted-dark uppercase tracking-wider mb-3">
          Network Config
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted mb-1 block">Source IP</label>
            <input
              type="text"
              value={srcIp}
              onChange={(e) => onSrcIpChange(e.target.value)}
              className="w-full px-3 py-2 bg-dark-600 border border-dark-500 rounded-lg
                       text-sm text-white font-mono
                       focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       transition-colors"
              placeholder="10.99.1.1"
            />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Destination IP</label>
            <input
              type="text"
              value={dstIp}
              onChange={(e) => onDstIpChange(e.target.value)}
              className="w-full px-3 py-2 bg-dark-600 border border-dark-500 rounded-lg
                       text-sm text-white font-mono
                       focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       transition-colors"
              placeholder="10.99.1.2"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted mb-1 block">
                Src Port <span className="text-muted-dark">(auto)</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={srcPort}
                onChange={(e) => onSrcPortChange(e.target.value.replace(/[^\d]/g, ''))}
                className="w-full px-3 py-2 bg-dark-600 border border-dark-500 rounded-lg
                         text-sm text-white font-mono
                         focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                         transition-colors"
                placeholder="auto"
              />
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Dst Port</label>
              <input
                type="number"
                value={port}
                onChange={(e) => onPortChange(parseInt(e.target.value) || 80)}
                min={1}
                max={65535}
                className="w-full px-3 py-2 bg-dark-600 border border-dark-500 rounded-lg
                         text-sm text-white font-mono
                         focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                         transition-colors"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GenerateConfigPanel;
