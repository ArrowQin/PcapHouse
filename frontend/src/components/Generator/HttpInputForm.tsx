import React from 'react';

interface HttpInputFormProps {
  mode: 'both' | 'request' | 'response';
  onModeChange: (mode: 'both' | 'request' | 'response') => void;
  rawRequest: string;
  onRequestChange: (v: string) => void;
  rawResponse: string;
  onResponseChange: (v: string) => void;
  protocol?: string;
}

const modes = [
  { key: 'both' as const, label: 'Request + Response' },
  { key: 'request' as const, label: 'Request Only' },
  { key: 'response' as const, label: 'Response Only' },
];

const HTTP1_REQUEST_PLACEHOLDER = `GET /api/v1/users HTTP/1.1
Host: example.com
User-Agent: Mozilla/5.0
Accept: application/json
Connection: keep-alive`;

const HTTP1_RESPONSE_PLACEHOLDER = `HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 27
Server: nginx/1.21.0

{"status":"ok","count":42}`;

// HTTP/2 uses HPACK-encoded headers + pseudo-headers on the wire, but the
// generator accepts the same plain-text form and re-encodes it as h2 frames
// (Host -> :authority, hop-by-hop headers stripped per RFC 7540 §8.1.2.2).
const HTTP2_REQUEST_PLACEHOLDER = `GET /api/v1/users HTTP/2
Host: example.com
user-agent: curl/8.4.0
accept: application/json`;

const HTTP2_RESPONSE_PLACEHOLDER = `HTTP/2 200
content-type: application/json
server: nginx/1.25.0

{"status":"ok","count":42}`;

const HttpInputForm: React.FC<HttpInputFormProps> = ({
  mode,
  onModeChange,
  rawRequest,
  onRequestChange,
  rawResponse,
  onResponseChange,
  protocol,
}) => {
  const showRequest = mode === 'both' || mode === 'request';
  const showResponse = mode === 'both' || mode === 'response';
  const isHttp2 = protocol === 'http2';
  const requestPlaceholder = isHttp2
    ? HTTP2_REQUEST_PLACEHOLDER
    : HTTP1_REQUEST_PLACEHOLDER;
  const responsePlaceholder = isHttp2
    ? HTTP2_RESPONSE_PLACEHOLDER
    : HTTP1_RESPONSE_PLACEHOLDER;
  const requestLabel = isHttp2 ? 'HTTP/2 Request' : 'HTTP Request';
  const responseLabel = isHttp2 ? 'HTTP/2 Response' : 'HTTP Response';

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Mode Tabs */}
      <div className="flex items-center gap-1 p-1 bg-dark-800 rounded-lg w-fit">
        {modes.map((m) => (
          <button
            key={m.key}
            onClick={() => onModeChange(m.key)}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer ${
              mode === m.key
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted hover:text-white'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Textareas */}
      <div className="flex gap-3 flex-1 min-h-0">
        {showRequest && (
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <label className="text-xs font-semibold text-muted-dark uppercase tracking-wider">
              {requestLabel}
            </label>
            <textarea
              value={rawRequest}
              onChange={(e) => onRequestChange(e.target.value)}
              placeholder={requestPlaceholder}
              className="w-full flex-1 min-h-[240px] px-4 py-3 bg-dark-600 border border-dark-500 rounded-xl
                       text-sm text-white font-mono placeholder-muted-dark/50
                       resize-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       transition-colors"
              spellCheck={false}
            />
          </div>
        )}

        {mode === 'both' && (
          <div className="w-px bg-dark-500 self-stretch mt-6" />
        )}

        {showResponse && (
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <label className="text-xs font-semibold text-muted-dark uppercase tracking-wider">
              {responseLabel}
            </label>
            <textarea
              value={rawResponse}
              onChange={(e) => onResponseChange(e.target.value)}
              placeholder={responsePlaceholder}
              className="w-full flex-1 min-h-[240px] px-4 py-3 bg-dark-600 border border-dark-500 rounded-xl
                       text-sm text-white font-mono placeholder-muted-dark/50
                       resize-none focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       transition-colors"
              spellCheck={false}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default HttpInputForm;
