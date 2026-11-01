import React, { useState } from 'react';
import { X, Copy, ExternalLink, Check, AlertCircle, Share2 } from 'lucide-react';

export interface ShareResult {
  fileName: string;
  cosUrl: string;
}

export interface ShareError {
  fileId: number;
  message: string;
}

interface ShareResultModalProps {
  shared: ShareResult[];
  errors: ShareError[];
  onClose: () => void;
}

const ShareResultModal: React.FC<ShareResultModalProps> = ({ shared, errors, onClose }) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const buildShareText = (item: ShareResult) => {
    return `📦 PcapHouse Shared File\n📄 File: ${item.fileName}\n🔗 URL: ${item.cosUrl}\n\nDownload the pcap file from the link above for traffic analysis.`;
  };

  const handleCopySingle = async (item: ShareResult, index: number) => {
    const text = buildShareText(item);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  const handleCopyAll = async () => {
    const text = shared
      .map((item) => buildShareText(item))
      .join('\n\n---\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    }
  };

  const handleOpen = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-dark-800 border border-dark-600 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-600">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10">
              <Share2 size={18} className="text-primary" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">Share Result</h3>
              <p className="text-xs text-muted mt-0.5">
                {shared.length > 0
                  ? `${shared.length} file(s) shared successfully`
                  : 'Share failed'}
                {errors.length > 0 && `, ${errors.length} error(s)`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-white hover:bg-dark-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {/* Success items */}
          {shared.map((item, index) => (
            <div
              key={index}
              className="rounded-lg border border-dark-500 bg-dark-700/50 p-4 space-y-2.5"
            >
              <div className="flex items-center gap-2">
                <Check size={14} className="text-success shrink-0" />
                <span className="text-sm font-medium text-white truncate">
                  {item.fileName}
                </span>
              </div>

              {/* URL display */}
              <div className="bg-dark-900 rounded-md px-3 py-2 border border-dark-500">
                <p className="text-xs text-muted break-all font-mono leading-relaxed select-all">
                  {item.cosUrl}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopySingle(item, index)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary transition-colors"
                >
                  {copiedIndex === index ? (
                    <>
                      <Check size={12} />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={12} />
                      Copy with Info
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleOpen(item.cosUrl)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-dark-600 hover:bg-dark-500 border border-dark-400 text-white transition-colors"
                >
                  <ExternalLink size={12} />
                  Open URL
                </button>
              </div>
            </div>
          ))}

          {/* Error items */}
          {errors.map((err, index) => (
            <div
              key={`err-${index}`}
              className="rounded-lg border border-danger/30 bg-danger/5 p-4"
            >
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-danger shrink-0" />
                <span className="text-sm text-danger">
                  File #{err.fileId}: {err.message}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-dark-600">
          {shared.length > 1 && (
            <button
              onClick={handleCopyAll}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-dark-600 hover:bg-dark-500 border border-dark-400 text-white transition-colors"
            >
              {copiedAll ? (
                <>
                  <Check size={12} />
                  All Copied!
                </>
              ) : (
                <>
                  <Copy size={12} />
                  Copy All
                </>
              )}
            </button>
          )}
          <div className="ml-auto">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-md text-sm font-medium bg-primary hover:bg-primary/90 text-white transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareResultModal;
