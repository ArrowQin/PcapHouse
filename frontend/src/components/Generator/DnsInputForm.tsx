import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DnsAnswer {
  type: string;
  data: string;
  ttl: number;
}

interface DnsInputFormProps {
  domain: string;
  onDomainChange: (v: string) => void;
  qtype: string;
  onQtypeChange: (v: string) => void;
  answers: DnsAnswer[];
  onAnswersChange: (v: DnsAnswer[]) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'] as const;

const DATA_PLACEHOLDERS: Record<string, string> = {
  A: '93.184.216.34',
  AAAA: '2606:2800:220:1:248:1893:25c8:1946',
  CNAME: 'cdn.example.com',
  MX: '10 mail.example.com',
  TXT: 'v=spf1 include:example.com ~all',
  NS: 'ns1.example.com',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DnsInputForm: React.FC<DnsInputFormProps> = ({
  domain,
  onDomainChange,
  qtype,
  onQtypeChange,
  answers,
  onAnswersChange,
}) => {
  const addAnswer = () => {
    onAnswersChange([
      ...answers,
      { type: qtype || 'A', data: '', ttl: 300 },
    ]);
  };

  const removeAnswer = (idx: number) => {
    onAnswersChange(answers.filter((_, i) => i !== idx));
  };

  const updateAnswer = (idx: number, patch: Partial<DnsAnswer>) => {
    onAnswersChange(
      answers.map((a, i) => (i === idx ? { ...a, ...patch } : a))
    );
  };

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Query section */}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-muted-dark uppercase tracking-wider">
          DNS Query
        </h3>

        <div className="flex gap-3">
          {/* Domain */}
          <div className="flex-1">
            <label className="text-xs text-muted mb-1 block">Domain Name</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => onDomainChange(e.target.value)}
              placeholder="example.com"
              className="w-full px-4 py-2.5 bg-dark-600 border border-dark-500 rounded-xl
                       text-sm text-white font-mono placeholder-muted-dark/50
                       focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       transition-colors"
              spellCheck={false}
            />
          </div>

          {/* Query type */}
          <div className="w-[140px]">
            <label className="text-xs text-muted mb-1 block">Query Type</label>
            <select
              value={qtype}
              onChange={(e) => onQtypeChange(e.target.value)}
              className="w-full px-3 py-2.5 bg-dark-600 border border-dark-500 rounded-xl
                       text-sm text-white
                       focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       transition-colors appearance-none cursor-pointer"
            >
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Answers section */}
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted-dark uppercase tracking-wider">
            Answer Records
          </h3>
          <button
            onClick={addAnswer}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium
                     text-primary hover:bg-primary/10 transition-colors cursor-pointer"
          >
            <Plus size={14} />
            Add Record
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {answers.length === 0 ? (
            <div className="text-center py-8 text-muted-dark text-sm border border-dashed border-dark-500 rounded-xl">
              No answer records yet.
              <br />
              Click "Add Record" to get started.
            </div>
          ) : (
            answers.map((ans, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-3 bg-dark-600 border border-dark-500 rounded-xl group"
              >
                {/* Record type */}
                <select
                  value={ans.type}
                  onChange={(e) => updateAnswer(idx, { type: e.target.value })}
                  className="w-[100px] px-2 py-1.5 bg-dark-700 border border-dark-500 rounded-lg
                           text-xs text-white
                           focus:outline-none focus:border-primary/50
                           transition-colors appearance-none cursor-pointer"
                >
                  {RECORD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>

                {/* Data */}
                <input
                  type="text"
                  value={ans.data}
                  onChange={(e) => updateAnswer(idx, { data: e.target.value })}
                  placeholder={DATA_PLACEHOLDERS[ans.type] || 'Record data'}
                  className="flex-1 px-3 py-1.5 bg-dark-700 border border-dark-500 rounded-lg
                           text-xs text-white font-mono placeholder-muted-dark/50
                           focus:outline-none focus:border-primary/50
                           transition-colors"
                  spellCheck={false}
                />

                {/* TTL */}
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-dark">TTL</span>
                  <input
                    type="number"
                    value={ans.ttl}
                    onChange={(e) =>
                      updateAnswer(idx, { ttl: parseInt(e.target.value) || 300 })
                    }
                    min={1}
                    className="w-[70px] px-2 py-1.5 bg-dark-700 border border-dark-500 rounded-lg
                             text-xs text-white font-mono
                             focus:outline-none focus:border-primary/50
                             transition-colors"
                  />
                </div>

                {/* Delete */}
                <button
                  onClick={() => removeAnswer(idx)}
                  className="p-1.5 rounded-lg text-muted-dark hover:text-red-400 hover:bg-red-400/10
                           opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                  title="Remove record"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default DnsInputForm;
