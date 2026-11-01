import React from 'react';
import { HexDumpData } from '../../types';

interface HexDumpProps {
  data: HexDumpData | null;
}

const HexDump: React.FC<HexDumpProps> = ({ data }) => {
  if (!data || data.offset.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-dark text-sm">
        Select a packet to view hex dump
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto font-mono text-xs leading-5 p-2">
      {data.offset.map((offset, i) => (
        <div key={i} className="flex whitespace-nowrap hover:bg-dark-600/30 rounded transition-colors">
          <span className="text-primary/60 w-20 text-right pr-4 select-none flex-shrink-0">
            {offset}
          </span>
          <span className="text-muted w-[430px] flex-shrink-0 tracking-wider">
            {data.hex[i]}
          </span>
          <span className="text-success/70 pl-4 flex-shrink-0">
            {data.ascii[i]}
          </span>
        </div>
      ))}
    </div>
  );
};

export default HexDump;
