import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Workflow, Zap, Loader2, RefreshCw } from 'lucide-react';
import HttpInputForm from '../components/Generator/HttpInputForm';
import DnsInputForm, { DnsAnswer } from '../components/Generator/DnsInputForm';
import WebSocketInputForm, {
  WebSocketConfig,
  buildWebSocketRawRequest,
} from '../components/Generator/WebSocketInputForm';
import GenerateConfigPanel from '../components/Generator/GenerateConfigPanel';
import TaskStatusCard from '../components/Generator/TaskStatusCard';
import { generatorApi } from '../api/generator';
import { GenerateTask, SupportedProtocol } from '../types';

const GeneratorPage: React.FC = () => {
  // Protocol selection is driven by the sidebar via ?protocol=<name>
  const [searchParams] = useSearchParams();
  const selectedProtocol = searchParams.get('protocol') || 'http';

  const [protocols, setProtocols] = useState<SupportedProtocol[]>([]);
  const currentProtocol: SupportedProtocol | undefined = useMemo(
    () =>
      protocols.find((p) => p.name === selectedProtocol) ?? {
        name: selectedProtocol,
        label: selectedProtocol.toUpperCase(),
        description: '',
        available: true,
      },
    [protocols, selectedProtocol]
  );

  // HTTP input
  const [mode, setMode] = useState<'both' | 'request' | 'response'>('both');
  const [rawRequest, setRawRequest] = useState('');
  const [rawResponse, setRawResponse] = useState('');

  // DNS input
  const [dnsDomain, setDnsDomain] = useState('');
  const [dnsQtype, setDnsQtype] = useState('A');
  const [dnsAnswers, setDnsAnswers] = useState<DnsAnswer[]>([
    { type: 'A', data: '', ttl: 300 },
  ]);

  // WebSocket input
  const [wsConfig, setWsConfig] = useState<WebSocketConfig>({
    path: '/ws',
    host: '',
    origin: '',
    extraHeaders: [],
    frames: [
      { direction: 'c2s', type: 'text', data: 'hello from client' },
      { direction: 's2c', type: 'text', data: 'hi from server' },
    ],
  });

  // Config
  const [srcIp, setSrcIp] = useState('10.99.1.1');
  const [dstIp, setDstIp] = useState('10.99.1.2');
  const [port, setPort] = useState(80);
  // Empty string = "auto-assign ephemeral port". Kept as string so an
  // empty input reliably means "don't pin".
  const [srcPort, setSrcPort] = useState('');
  const [filename, setFilename] = useState('');

  // Tasks
  const [tasks, setTasks] = useState<GenerateTask[]>([]);
  const [generating, setGenerating] = useState(false);

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initial load
  useEffect(() => {
    generatorApi.getSupportedProtocols().then((r) => setProtocols(r.data)).catch(console.error);
    loadTasks();
  }, []);

  // Switch default port when protocol changes
  useEffect(() => {
    const defaultPorts: Record<string, number> = {
      http: 80,
      dns: 53,
      websocket: 80,
      http2: 80,
    };
    setPort(defaultPorts[selectedProtocol] ?? 80);
  }, [selectedProtocol]);

  const loadTasks = useCallback(async () => {
    const res = await generatorApi.getTasks(20).catch(() => null);
    if (res) setTasks(res.data);
  }, []);

  // Poll for in-progress tasks
  useEffect(() => {
    const hasRunning = tasks.some(
      (t) => !['success', 'failed'].includes(t.status)
    );
    if (hasRunning && !pollRef.current) {
      pollRef.current = setInterval(loadTasks, 1500);
    } else if (!hasRunning && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [tasks, loadTasks]);

  // Generate handler
  const handleGenerate = async () => {
    setGenerating(true);
    const parsedSrcPort = srcPort.trim() ? parseInt(srcPort, 10) : null;

    let reqBody: string;
    let resBody: string;

    if (selectedProtocol === 'dns') {
      // Serialize structured DNS form data into JSON for raw_request
      reqBody = JSON.stringify({
        domain: dnsDomain.trim(),
        qtype: dnsQtype,
        answers: dnsAnswers,
      });
      resBody = '';
    } else if (selectedProtocol === 'websocket') {
      reqBody = buildWebSocketRawRequest(wsConfig);
      resBody = '';
    } else {
      reqBody = mode !== 'response' ? rawRequest : '';
      resBody = mode !== 'request' ? rawResponse : '';
    }

    const res = await generatorApi.generate({
      protocol: selectedProtocol,
      raw_request: reqBody,
      raw_response: resBody,
      src_ip: srcIp,
      dst_ip: dstIp,
      port,
      src_port: parsedSrcPort && !Number.isNaN(parsedSrcPort) ? parsedSrcPort : null,
      filename: filename || undefined,
    }).catch((err) => {
      console.error('Generate failed:', err);
      return null;
    });

    if (res) {
      setTasks((prev) => [res.data, ...prev]);
    }
    setGenerating(false);
  };

  const canGenerate = (() => {
    if (generating) return false;
    if (selectedProtocol === 'dns') {
      return (
        dnsDomain.trim().length > 0 &&
        dnsAnswers.length > 0 &&
        dnsAnswers.every((a) => a.data.trim().length > 0)
      );
    }
    if (selectedProtocol === 'websocket') {
      if (wsConfig.frames.length === 0) return false;
      // Every binary frame must carry at least one hex byte and must be
      // valid hex; text frames may be empty (a zero-length text frame is
      // perfectly legal on the wire).
      return wsConfig.frames.every((f) => {
        if (f.type === 'binary') {
          const hex = f.data.replace(/\s+/g, '');
          return hex.length > 0 && hex.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(hex);
        }
        return true;
      });
    }
    // HTTP (default)
    return (
      (mode !== 'response' && rawRequest.trim().length > 0) ||
      (mode !== 'request' && rawResponse.trim().length > 0)
    );
  })();

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Page Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Workflow size={22} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">
              {currentProtocol.label} Generator
            </h1>
            <p className="text-xs text-muted">
              {currentProtocol.description ||
                `Generate pcap traffic for the ${currentProtocol.label} protocol`}
            </p>
          </div>
        </div>
      </div>

      {/* Main 2-column layout */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* Left: Input + Action */}
        <div className="flex-[2] flex flex-col gap-5 min-w-0">
          {/* Input Form */}
          {selectedProtocol === 'dns' ? (
            <DnsInputForm
              domain={dnsDomain}
              onDomainChange={setDnsDomain}
              qtype={dnsQtype}
              onQtypeChange={setDnsQtype}
              answers={dnsAnswers}
              onAnswersChange={setDnsAnswers}
            />
          ) : selectedProtocol === 'websocket' ? (
            <WebSocketInputForm config={wsConfig} onChange={setWsConfig} />
          ) : (
            <HttpInputForm
              mode={mode}
              onModeChange={setMode}
              rawRequest={rawRequest}
              onRequestChange={setRawRequest}
              rawResponse={rawResponse}
              onResponseChange={setRawResponse}
              protocol={selectedProtocol}
            />
          )}

          {/* Action Row */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder={`generated-${selectedProtocol}-${Math.floor(Date.now() / 1000)}.pcap`}
              className="flex-1 px-4 py-2.5 bg-dark-600 border border-dark-500 rounded-xl
                       text-sm text-white font-mono placeholder-muted-dark/50
                       focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20
                       transition-colors"
            />
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
                canGenerate
                  ? 'bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/25 cursor-pointer'
                  : 'bg-dark-500 text-muted-dark cursor-not-allowed'
              }`}
            >
              {generating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Zap size={16} />
              )}
              {generating ? 'Generating…' : 'Generate Pcap'}
            </button>
          </div>
        </div>

        {/* Right: Config + Tasks */}
        <div className="w-[320px] flex-shrink-0 flex flex-col gap-5 min-h-0">
          {/* Config Panel */}
          <div className="p-4 bg-dark-700 border border-dark-600 rounded-xl">
            <GenerateConfigPanel
              srcIp={srcIp}
              onSrcIpChange={setSrcIp}
              dstIp={dstIp}
              onDstIpChange={setDstIp}
              port={port}
              onPortChange={setPort}
              srcPort={srcPort}
              onSrcPortChange={setSrcPort}
            />
          </div>

          {/* Recent Tasks */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-dark uppercase tracking-wider">
                Recent Tasks
              </h3>
              <button
                onClick={loadTasks}
                className="p-1 rounded text-muted hover:text-white transition-colors cursor-pointer"
                title="Refresh"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {tasks.length === 0 ? (
                <div className="text-center py-8 text-muted-dark text-sm">
                  No tasks yet. Generate your first pcap!
                </div>
              ) : (
                tasks.map((t) => <TaskStatusCard key={t.id} task={t} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GeneratorPage;
