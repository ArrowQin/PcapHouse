import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FixedSizeList as VirtualList } from 'react-window';
import { PcapFrame } from '../../types';

interface PacketListProps {
  frames: PcapFrame[];
  total: number;
  selectedFrame: number | null;
  onSelectFrame: (frameNum: number) => void;
  onLoadMore: () => void;
  loading: boolean;
}

const getProtocolColor = (protocol: string) => {
  const colors: Record<string, string> = {
    TCP: '#3B82F6',
    UDP: '#22C55E',
    HTTP: '#F59E0B',
    HTTPS: '#8B5CF6',
    TLS: '#8B5CF6',
    DNS: '#EC4899',
    ICMP: '#06B6D4',
    ARP: '#F97316',
    SSH: '#10B981',
    FTP: '#A855F7',
    SMTP: '#F43F5E',
    STP: '#84CC16',
  };
  return colors[protocol?.toUpperCase()] || '#64748B';
};

const columns = [
  { key: 'number', label: 'No.', width: 60 },
  { key: 'time', label: 'Time', width: 100 },
  { key: 'source', label: 'Source', width: 140 },
  { key: 'destination', label: 'Destination', width: 140 },
  { key: 'protocol', label: 'Protocol', width: 80 },
  { key: 'length', label: 'Length', width: 60 },
  { key: 'info', label: 'Info', width: 0 },
];

const PacketList: React.FC<PacketListProps> = ({
  frames,
  total,
  selectedFrame,
  onSelectFrame,
  onLoadMore,
  loading,
}) => {
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(300);

  // Observe container resize so the virtual list fills available space.
  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        if (h > 0) setListHeight(h);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const Row = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const frame = frames[index];
      if (!frame) return null;

      const isSelected = selectedFrame === frame.number;
      const protocolColor = getProtocolColor(frame.protocol);

      return (
        <div
          style={style}
          onClick={() => onSelectFrame(frame.number)}
          className={`flex items-center text-xs font-mono cursor-pointer border-b transition-colors ${
            isSelected
              ? 'bg-primary/15 border-primary/20 text-white'
              : 'border-dark-600/30 text-muted hover:bg-dark-600/30'
          }`}
        >
          <div className="w-[60px] px-2 text-muted-dark text-right flex-shrink-0">
            {frame.number}
          </div>
          <div className="w-[100px] px-2 flex-shrink-0 truncate">
            {frame.time}
          </div>
          <div className="w-[140px] px-2 flex-shrink-0 truncate text-white">
            {frame.source}
          </div>
          <div className="w-[140px] px-2 flex-shrink-0 truncate text-white">
            {frame.destination}
          </div>
          <div className="w-[80px] px-2 flex-shrink-0">
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-bold"
              style={{
                backgroundColor: `${protocolColor}20`,
                color: protocolColor,
              }}
            >
              {frame.protocol}
            </span>
          </div>
          <div className="w-[60px] px-2 flex-shrink-0 text-right text-muted-dark">
            {frame.length}
          </div>
          <div className="flex-1 px-2 truncate text-muted">
            {frame.info}
          </div>
        </div>
      );
    },
    [frames, selectedFrame, onSelectFrame]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center text-[11px] font-semibold text-muted-dark uppercase tracking-wider bg-dark-800 border-b border-dark-600 py-2">
        {columns.map((col) => (
          <div
            key={col.key}
            className={`px-2 flex-shrink-0 ${col.key === 'number' || col.key === 'length' ? 'text-right' : ''}`}
            style={{ width: col.width || undefined, flex: col.width === 0 ? 1 : undefined }}
          >
            {col.label}
          </div>
        ))}
      </div>

      {/* Virtual List */}
      <div className="flex-1">
        {frames.length > 0 ? (
          <VirtualList
            height={300}
            width="100%"
            itemCount={frames.length}
            itemSize={28}
          >
            {Row}
          </VirtualList>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-dark text-sm">
            {loading ? 'Loading packets...' : 'No packets to display'}
          </div>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-dark-800 border-t border-dark-600 text-[10px] text-muted-dark">
        <span>Showing {frames.length} of {total} packets</span>
        {frames.length < total && (
          <button
            onClick={onLoadMore}
            className="text-primary hover:underline"
          >
            Load more...
          </button>
        )}
      </div>
    </div>
  );
};

export default PacketList;
