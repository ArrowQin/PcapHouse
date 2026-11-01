import React, { useEffect, useState } from 'react';
import { HardDrive, FileText, Activity as ActivityIcon, Clock } from 'lucide-react';
import apiClient from '../../api/client';
import { Activity, StorageInfo } from '../../types';

interface RightPanelProps {
  /**
   * Optional content rendered at the very top of the right panel.
   * Used e.g. to embed an UploadZone on the All Files page.
   */
  uploadSlot?: React.ReactNode;
}

const RightPanel: React.FC<RightPanelProps> = ({ uploadSlot }) => {
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const [storageRes, activityRes] = await Promise.all([
        apiClient.get('/storage'),
        apiClient.get('/activities'),
      ]);
      setStorage(storageRes.data);
      setActivities(activityRes.data);
    };
    fetchData();
  }, []);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const timeAgo = (dateStr: string) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    return `${Math.floor(diff / 86400)} days ago`;
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'upload': return '📤';
      case 'download': return '📥';
      case 'delete': return '🗑️';
      case 'create_category': return '📁';
      default: return '📋';
    }
  };

  return (
    <div className="w-72 flex-shrink-0 space-y-6">
      {/* Upload Zone Slot (if provided) */}
      {uploadSlot}

      {/* Storage Info */}
      <div className="rounded-xl bg-dark-700 border border-dark-600 p-5">
        <div className="flex items-center gap-2 mb-4">
          <HardDrive size={18} className="text-primary" />
          <h3 className="text-sm font-semibold text-white">Storage</h3>
        </div>

        {storage && (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="text-muted">Used</span>
                <span className="text-white font-medium">{formatSize(storage.total_size)}</span>
              </div>
              <div className="w-full h-2 bg-dark-600 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500"
                  style={{ width: `${Math.min((storage.total_size / (1024 * 1024 * 1024)) * 100, 100)}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-dark-600/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-white">{storage.total_files}</p>
                <p className="text-[10px] text-muted-dark uppercase">Files</p>
              </div>
              <div className="bg-dark-600/50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-white">{storage.total_categories || 0}</p>
                <p className="text-[10px] text-muted-dark uppercase">Categories</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Activity Log */}
      <div className="rounded-xl bg-dark-700 border border-dark-600 p-5">
        <div className="flex items-center gap-2 mb-4">
          <ActivityIcon size={18} className="text-primary" />
          <h3 className="text-sm font-semibold text-white">Activities</h3>
        </div>

        <div className="space-y-3 max-h-80 overflow-y-auto">
          {activities.length === 0 ? (
            <p className="text-xs text-muted-dark text-center py-4">No recent activity</p>
          ) : (
            activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-3 pb-3 border-b border-dark-600/50 last:border-0"
              >
                <span className="text-sm mt-0.5">{getActionIcon(activity.action)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-white truncate">
                    {activity.description}
                  </p>
                  {activity.file_name && (
                    <p className="text-[10px] text-primary truncate mt-0.5">
                      {activity.file_name}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-dark mt-1 flex items-center gap-1">
                    <Clock size={10} />
                    {timeAgo(activity.created_at)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default RightPanel;
