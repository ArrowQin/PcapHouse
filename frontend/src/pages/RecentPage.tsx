import React, { useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, FileText, Download } from 'lucide-react';
import { useFileStore } from '../stores/fileStore';
import { fileApi } from '../api/files';
import TagBadge from '../components/common/TagBadge';
import StarButton from '../components/common/StarButton';
import PageHeader from '../components/common/PageHeader';
import { PcapFile } from '../types';

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

type Bucket = 'Today' | 'Yesterday' | 'Earlier this week' | 'Earlier';

const bucketOf = (dateStr: string): Bucket => {
  const d = new Date(dateStr);
  const now = new Date();

  const startOfDay = (x: Date) => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    return c;
  };

  const today = startOfDay(now);
  const uploadDay = startOfDay(d);
  const diffDays = Math.floor(
    (today.getTime() - uploadDay.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'Earlier this week';
  return 'Earlier';
};

const BUCKET_ORDER: Bucket[] = [
  'Today',
  'Yesterday',
  'Earlier this week',
  'Earlier',
];

const RecentPage: React.FC = () => {
  const navigate = useNavigate();
  const { files, fetchFiles, toggleFavorite, setSearchParams } = useFileStore();

  useEffect(() => {
    setSearchParams({
      page: 1,
      page_size: 50,
      sort_by: 'upload_time',
      sort_order: 'desc',
      is_favorite: undefined,
      category_id: undefined,
      tag_ids: undefined,
      q: undefined,
    });
    fetchFiles();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<Bucket, PcapFile[]>();
    for (const f of files) {
      const b = bucketOf(f.upload_time);
      const list = map.get(b) ?? [];
      list.push(f);
      map.set(b, list);
    }
    return map;
  }, [files]);

  const handleDownload = useCallback(
    async (e: React.MouseEvent, id: number, name: string) => {
      e.stopPropagation();
      const res = await fileApi.downloadFile(id);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.URL.revokeObjectURL(url);
    },
    []
  );

  return (
    <div>
      {/* Page Header */}
      <PageHeader
        icon={<Clock size={24} className="text-primary" />}
        title="Recent Uploads"
        description="Files uploaded to your repository, grouped by time"
      />

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-dark">
          <Clock size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium mb-1">No recent uploads</p>
          <p className="text-sm">Upload pcap files from the Files page to see them here</p>
        </div>
      ) : (
        <div className="space-y-8">
          {BUCKET_ORDER.map((bucket) => {
            const items = grouped.get(bucket);
            if (!items || items.length === 0) return null;
            return (
              <section key={bucket}>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-xs font-semibold text-muted-dark uppercase tracking-wider">
                    {bucket}
                  </h2>
                  <div className="h-px flex-1 bg-dark-600/50" />
                  <span className="text-xs text-muted-dark">
                    {items.length} file{items.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="rounded-xl bg-dark-700 border border-dark-600 divide-y divide-dark-600">
                  {items.map((file) => (
                    <div
                      key={file.id}
                      onClick={() => navigate(`/pcap/${file.id}`)}
                      className="flex items-center gap-4 px-4 py-3 hover:bg-dark-600/50 cursor-pointer group transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileText size={18} className="text-primary" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-sm font-medium text-white truncate group-hover:text-primary transition-colors">
                            {file.name}
                          </h3>
                          {file.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {file.tags.slice(0, 3).map((tag) => (
                                <TagBadge key={tag.id} tag={tag} size="sm" />
                              ))}
                              {file.tags.length > 3 && (
                                <span className="text-[10px] text-muted-dark">
                                  +{file.tags.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-dark">
                          <span>{formatSize(file.size)}</span>
                          <span>·</span>
                          <span>{formatTime(file.upload_time)}</span>
                          {file.protocol_summary && (
                            <>
                              <span>·</span>
                              <span className="truncate">{file.protocol_summary}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleDownload(e, file.id, file.name)}
                          className="p-2 rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-all"
                          title="Download"
                        >
                          <Download size={16} />
                        </button>
                      </div>
                      <StarButton
                        isFavorite={file.is_favorite}
                        onClick={() => toggleFavorite(file.id)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RecentPage;
