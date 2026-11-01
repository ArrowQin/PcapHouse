import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Download, Trash2, Eye } from 'lucide-react';
import { PcapFile } from '../../types';
import StarButton from '../common/StarButton';
import TagBadge from '../common/TagBadge';

interface FileGridProps {
  files: PcapFile[];
  onToggleFavorite: (id: number) => void;
  onDelete: (id: number) => void;
  onDownload: (id: number, name: string) => void;
  /** Multi-select wiring; optional so non-Files pages can reuse the grid. */
  selectedIds?: Set<number>;
  onToggleSelect?: (id: number) => void;
}

const FileGrid: React.FC<FileGridProps> = ({
  files,
  onToggleFavorite,
  onDelete,
  onDownload,
  selectedIds,
  onToggleSelect,
}) => {
  const navigate = useNavigate();
  const selectionEnabled = !!selectedIds && !!onToggleSelect;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-dark">
        <FileText size={48} className="mb-4 opacity-30" />
        <p className="text-lg font-medium mb-1">No files found</p>
        <p className="text-sm">Upload some pcap files to get started</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {files.map((file) => {
        const selected = selectionEnabled && selectedIds!.has(file.id);
        return (
          <div
            key={file.id}
            onClick={() => navigate(`/pcap/${file.id}`)}
            className={`relative rounded-xl bg-dark-700 border p-4 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 cursor-pointer group ${
              selected
                ? 'border-primary/70 ring-1 ring-primary/50'
                : 'border-dark-600 hover:border-dark-500'
            }`}
          >
            {selectionEnabled && (
              // Checkbox sits absolutely in the top-left so it doesn't
              // disturb the existing card layout. `stopPropagation` keeps
              // the click from navigating into the file detail page.
              <label
                className="absolute top-2 left-2 z-10 flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${file.name}`}
                  checked={selected}
                  onChange={() => onToggleSelect!(file.id)}
                  className="h-4 w-4 accent-primary cursor-pointer"
                />
              </label>
            )}
            <div className="flex items-start justify-between mb-3">
              <div
                className={`w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center ${
                  selectionEnabled ? 'ml-6' : ''
                }`}
              >
                <FileText size={20} className="text-primary" />
              </div>
              <StarButton
                isFavorite={file.is_favorite}
                onClick={() => onToggleFavorite(file.id)}
                size={14}
              />
            </div>

            <h4 className="text-sm font-medium text-white truncate mb-1">
              {file.name}
            </h4>
            <p className="text-xs text-muted-dark mb-3">{formatSize(file.size)}</p>

            {file.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {file.tags.slice(0, 2).map((tag) => (
                  <TagBadge key={tag.id} tag={tag} size="sm" />
                ))}
              </div>
            )}

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-2 border-t border-dark-600/50">
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/pcap/${file.id}`); }}
                className="p-1.5 rounded text-muted hover:text-primary transition-colors"
              >
                <Eye size={14} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDownload(file.id, file.name); }}
                className="p-1.5 rounded text-muted hover:text-success transition-colors"
              >
                <Download size={14} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(file.id); }}
                className="p-1.5 rounded text-muted hover:text-danger transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default FileGrid;
