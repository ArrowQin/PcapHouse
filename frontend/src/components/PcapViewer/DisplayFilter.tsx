import React, { useState, useCallback } from 'react';
import { Search, X } from 'lucide-react';

interface DisplayFilterProps {
  onApplyFilter: (filter: string) => void;
}

const filterExamples = [
  'tcp.port == 80',
  'ip.addr == 192.168.1.1',
  'http',
  'dns',
  'tcp.flags.syn == 1',
  'frame.len > 1000',
];

const DisplayFilter: React.FC<DisplayFilterProps> = ({ onApplyFilter }) => {
  const [value, setValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleApply = useCallback(() => {
    onApplyFilter(value);
    setShowSuggestions(false);
  }, [value, onApplyFilter]);

  const handleClear = useCallback(() => {
    setValue('');
    onApplyFilter('');
    setShowSuggestions(false);
  }, [onApplyFilter]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-dark" />
          <input
            type="text"
            placeholder="Apply display filter... (e.g. tcp.port == 80)"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleApply();
              if (e.key === 'Escape') setShowSuggestions(false);
            }}
            className="w-full h-9 pl-9 pr-8 rounded-lg bg-dark-700 border border-dark-500 text-xs text-white font-mono placeholder-muted-dark focus:border-primary focus:ring-1 focus:ring-primary/30 focus:outline-none transition-all"
          />
          {value && (
            <button
              onClick={handleClear}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-dark hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={handleApply}
          className="h-9 px-4 rounded-lg bg-primary hover:bg-primary-hover text-white text-xs font-medium transition-colors"
        >
          Apply
        </button>
      </div>

      {showSuggestions && !value && (
        <div className="absolute top-full mt-1 left-0 right-12 z-10 bg-dark-700 border border-dark-500 rounded-lg shadow-xl py-1">
          <div className="px-3 py-1.5 text-[10px] text-muted-dark uppercase tracking-wider">
            Filter examples
          </div>
          {filterExamples.map((filter) => (
            <button
              key={filter}
              onClick={() => {
                setValue(filter);
                setShowSuggestions(false);
              }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono text-muted hover:text-white hover:bg-dark-600 transition-colors"
            >
              {filter}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default DisplayFilter;
