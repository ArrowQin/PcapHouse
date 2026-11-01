import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Info } from 'lucide-react';
import PacketList from '../components/PcapViewer/PacketList';
import ProtocolTree from '../components/PcapViewer/ProtocolTree';
import HexDump from '../components/PcapViewer/HexDump';
import DisplayFilter from '../components/PcapViewer/DisplayFilter';
import CategorySelect from '../components/common/CategorySelect';
import TagSelect from '../components/common/TagSelect';
import { pcapApi } from '../api/pcap';
import { fileApi } from '../api/files';
import { categoryApi } from '../api/categories';
import { tagApi } from '../api/tags';
import apiClient from '../api/client';
import {
  PcapFile,
  PcapFrame,
  ProtocolNode,
  HexDumpData,
  Category,
  Tag,
} from '../types';

const PcapDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileId = parseInt(id || '0');

  const [file, setFile] = useState<PcapFile | null>(null);
  const [frames, setFrames] = useState<PcapFrame[]>([]);
  const [totalFrames, setTotalFrames] = useState(0);
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [protocols, setProtocols] = useState<ProtocolNode[]>([]);
  const [hexData, setHexData] = useState<HexDumpData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharkdAvailable, setSharkdAvailable] = useState(true);
  const [filter, setFilter] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);

  useEffect(() => {
    if (!fileId) return;

    const loadFile = async () => {
      const res = await fileApi.getFile(fileId);
      setFile(res.data);
    };
    loadFile();

    const checkSharkd = async () => {
      const res = await apiClient.get('/pcap/status');
      setSharkdAvailable(res.data.available);
    };
    checkSharkd();

    categoryApi.getCategories().then((res) => setCategories(res.data)).catch(() => {});
    tagApi.getTags().then((res) => setAllTags(res.data)).catch(() => {});
  }, [fileId]);

  const handleChangeCategory = useCallback(
    async (categoryId: number | null) => {
      const res = await fileApi.moveFile(fileId, categoryId);
      setFile(res.data);
    },
    [fileId]
  );

  const handleChangeTags = useCallback(
    async (tagIds: number[]) => {
      await fileApi.updateFileTags(fileId, tagIds);
      const nextTags = allTags.filter((t) => tagIds.includes(t.id));
      setFile((prev) => (prev ? { ...prev, tags: nextTags } : prev));
    },
    [fileId, allTags]
  );

  const loadFrames = useCallback(
    async (append = false) => {
      if (!sharkdAvailable) return;
      setLoading(true);
      const offset = append ? frames.length : 0;
      const res = await pcapApi.getFrames(fileId, {
        offset,
        limit: 200,
        filter: filter || undefined,
      });
      if (append) {
        setFrames((prev) => [...prev, ...res.data.frames]);
      } else {
        setFrames(res.data.frames);
      }
      setTotalFrames(res.data.total);
      setLoading(false);
    },
    [fileId, filter, frames.length, sharkdAvailable]
  );

  useEffect(() => {
    if (sharkdAvailable && fileId) {
      loadFrames(false);
    }
  }, [fileId, filter, sharkdAvailable]);

  const handleSelectFrame = useCallback(
    async (frameNum: number) => {
      setSelectedFrame(frameNum);

      const [detailRes, hexRes] = await Promise.all([
        pcapApi.getFrameDetail(fileId, frameNum),
        pcapApi.getHexDump(fileId, frameNum),
      ]);

      setProtocols(detailRes.data.protocols);
      setHexData(hexRes.data);
    },
    [fileId]
  );

  const handleDownload = useCallback(async () => {
    if (!file) return;
    const res = await fileApi.downloadFile(fileId);
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    window.URL.revokeObjectURL(url);
  }, [file, fileId]);

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg text-muted hover:text-white hover:bg-dark-600 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-dark mb-1">
              <span>Files</span>
              <span>/</span>
              <span className="text-muted">{file?.name || 'Loading...'}</span>
            </div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <FileText size={22} className="text-primary" />
              {file?.name || 'Loading...'}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {file && (
            <div className="flex items-center gap-3 text-xs text-muted mr-4">
              <span>{(file.size / 1024).toFixed(1)} KB</span>
              <span className="text-muted-dark">·</span>
              <span>{file.protocol_summary || 'Unknown'}</span>
              <span className="text-muted-dark">·</span>
              <CategorySelect
                value={file.category_id}
                categories={categories}
                onChange={handleChangeCategory}
                fallbackName={file.category?.name}
              />
              <TagSelect
                value={file.tags}
                allTags={allTags}
                onChange={handleChangeTags}
              />
            </div>
          )}
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors"
          >
            <Download size={16} />
            Download
          </button>
        </div>
      </div>

      {!sharkdAvailable ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Info size={48} className="text-warning mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">Sharkd Not Available</h2>
            <p className="text-muted max-w-md">
              The Wireshark sharkd service is not running. Please install Wireshark and ensure
              sharkd is in your PATH to enable pcap file viewing.
            </p>
            <code className="mt-4 inline-block px-4 py-2 rounded-lg bg-dark-700 text-primary text-sm font-mono">
              brew install wireshark
            </code>
          </div>
        </div>
      ) : (
        <>
          {/* Display Filter */}
          <div className="mb-3">
            <DisplayFilter onApplyFilter={setFilter} />
          </div>

          {/* Three-panel viewer */}
          <div className="flex-1 flex flex-col gap-1 min-h-0">
            {/* Packet List */}
            <div className="h-[40%] min-h-[200px] rounded-lg border border-dark-600 overflow-hidden bg-dark-700">
              <PacketList
                frames={frames}
                total={totalFrames}
                selectedFrame={selectedFrame}
                onSelectFrame={handleSelectFrame}
                onLoadMore={() => loadFrames(true)}
                loading={loading}
              />
            </div>

            {/* Protocol Tree & Hex Dump */}
            <div className="flex-1 flex gap-1 min-h-0">
              <div className="flex-1 rounded-lg border border-dark-600 overflow-hidden bg-dark-700">
                <div className="px-3 py-1.5 bg-dark-800 border-b border-dark-600 text-[11px] font-semibold text-muted-dark uppercase tracking-wider">
                  Protocol Tree
                </div>
                <div className="h-[calc(100%-28px)] overflow-auto">
                  <ProtocolTree protocols={protocols} />
                </div>
              </div>

              <div className="flex-1 rounded-lg border border-dark-600 overflow-hidden bg-dark-700">
                <div className="px-3 py-1.5 bg-dark-800 border-b border-dark-600 text-[11px] font-semibold text-muted-dark uppercase tracking-wider">
                  Hex Dump
                </div>
                <div className="h-[calc(100%-28px)] overflow-auto">
                  <HexDump data={hexData} />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PcapDetailPage;
