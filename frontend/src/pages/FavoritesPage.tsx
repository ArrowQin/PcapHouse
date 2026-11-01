import React, { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, FileText } from 'lucide-react';
import { useFileStore } from '../stores/fileStore';
import { fileApi } from '../api/files';
import TagBadge from '../components/common/TagBadge';
import StarButton from '../components/common/StarButton';
import PageHeader from '../components/common/PageHeader';

const FavoritesPage: React.FC = () => {
  const navigate = useNavigate();
  const { files, total, fetchFiles, toggleFavorite, setSearchParams } = useFileStore();

  useEffect(() => {
    setSearchParams({ is_favorite: true, page: 1, page_size: 50 });
    fetchFiles();
    return () => {
      setSearchParams({ is_favorite: undefined });
    };
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handleDownload = useCallback(async (id: number, name: string) => {
    const res = await fileApi.downloadFile(id);
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    window.URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="h-full overflow-y-auto pr-1">
      <PageHeader
        icon={<Star size={24} className="text-warning" fill="currentColor" />}
        title="Favorites"
        description="Your starred files for quick access"
      />

      {files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-dark">
          <Star size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium mb-1">No favorites yet</p>
          <p className="text-sm">Star files from the Files page to see them here</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.map((file) => (
            <div
              key={file.id}
              onClick={() => navigate(`/pcap/${file.id}`)}
              className="rounded-xl bg-dark-700 border border-dark-600 p-5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <FileText size={24} className="text-primary" />
                </div>
                <StarButton
                  isFavorite={file.is_favorite}
                  onClick={() => toggleFavorite(file.id)}
                />
              </div>
              <h3 className="text-sm font-semibold text-white mb-1 truncate group-hover:text-primary transition-colors">
                {file.name}
              </h3>
              <div className="flex items-center gap-3 text-xs text-muted-dark mb-3">
                <span>{formatSize(file.size)}</span>
                <span>·</span>
                <span>{formatDate(file.upload_time)}</span>
              </div>
              {file.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {file.tags.map((tag) => (
                    <TagBadge key={tag.id} tag={tag} size="sm" />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FavoritesPage;
