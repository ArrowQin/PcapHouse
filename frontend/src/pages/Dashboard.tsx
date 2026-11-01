import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  HardDrive,
  FolderTree,
  Tags,
  TrendingUp,
  Clock,
  ArrowUpRight,
  LayoutDashboard,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import apiClient from '../api/client';
import { fileApi } from '../api/files';
import { categoryApi } from '../api/categories';
import { tagApi } from '../api/tags';
import { PcapFile, Activity } from '../types';
import PageHeader from '../components/common/PageHeader';

const protocolColors = ['#3B82F6', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#64748B'];

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalSize: 0,
    totalCategories: 0,
    totalTags: 0,
  });
  const [recentFiles, setRecentFiles] = useState<PcapFile[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [protocolData, setProtocolData] = useState<{ name: string; value: number }[]>([]);

  useEffect(() => {
    const loadData = async () => {
      const [storageRes, filesRes, categoriesRes, tagsRes, activityRes, protoRes] = await Promise.all([
        apiClient.get('/storage'),
        fileApi.getFiles({ page: 1, page_size: 5, sort_by: 'upload_time', sort_order: 'desc' }),
        categoryApi.getCategories(),
        tagApi.getTags(),
        apiClient.get('/activities'),
        // Library-wide protocol distribution. Computed server-side so
        // the donut reflects the whole library rather than just the 5
        // most recent uploads (which was the previous, misleading
        // behavior — the legend would routinely sum to more than the
        // visible "recent files" count).
        fileApi.getProtocolDistribution(),
      ]);

      setStats({
        totalFiles: storageRes.data.total_files,
        totalSize: storageRes.data.total_size,
        totalCategories: categoriesRes.data.length,
        totalTags: tagsRes.data.length,
      });
      setRecentFiles(filesRes.data.files);
      setActivities(activityRes.data.slice(0, 8));

      // Backend already returns entries sorted by count desc, name asc.
      // We cap at the top 8 to match the palette length (protocolColors
      // has 8 entries) and to keep the legend readable.
      setProtocolData(
        protoRes.data
          .slice(0, 8)
          .map((p) => ({ name: p.name, value: p.count }))
      );
    };
    loadData();
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
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const statCards = [
    {
      label: 'Total Files',
      value: stats.totalFiles,
      icon: <FileText size={22} />,
      color: '#3B82F6',
      bgColor: 'from-blue-500/10 to-blue-600/5',
    },
    {
      label: 'Storage Used',
      value: formatSize(stats.totalSize),
      icon: <HardDrive size={22} />,
      color: '#22C55E',
      bgColor: 'from-green-500/10 to-green-600/5',
    },
    {
      label: 'Categories',
      value: stats.totalCategories,
      icon: <FolderTree size={22} />,
      color: '#F59E0B',
      bgColor: 'from-amber-500/10 to-amber-600/5',
    },
    {
      label: 'Tags',
      value: stats.totalTags,
      icon: <Tags size={22} />,
      color: '#8B5CF6',
      bgColor: 'from-violet-500/10 to-violet-600/5',
    },
  ];

  return (
    <div className="h-full overflow-y-auto pr-1">
      {/* Page Header */}
      <PageHeader
        icon={<LayoutDashboard size={24} className="text-primary" />}
        title="Dashboard"
        description="Overview of your pcap file repository"
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card) => (
          <div
            key={card.label}
            className={`rounded-xl bg-gradient-to-br ${card.bgColor} border border-dark-600 p-5 hover:border-dark-500 transition-all duration-300 hover:shadow-lg group`}
          >
            <div className="flex items-center justify-between mb-4">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${card.color}15`, color: card.color }}
              >
                {card.icon}
              </div>
              <TrendingUp size={16} className="text-success opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="text-2xl font-bold text-white mb-1">{card.value}</p>
            <p className="text-xs text-muted-dark">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Protocol Distribution */}
        <div className="rounded-xl bg-dark-700 border border-dark-600 p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Protocol Distribution</h3>
          {protocolData.length > 0 ? (
            <div className="flex items-center gap-4">
              <div className="w-40 h-40">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={protocolData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={65}
                      paddingAngle={3}
                      dataKey="value"
                      nameKey="name"
                    >
                      {protocolData.map((_, i) => (
                        <Cell key={i} fill={protocolColors[i % protocolColors.length]} />
                      ))}
                    </Pie>
                    {/*
                      Hover tooltip. We render it with the same dark
                      palette as the rest of the dashboard and a custom
                      formatter so the label reads like "tcp: 42" rather
                      than recharts' default "value: 42".
                    */}
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      contentStyle={{
                        backgroundColor: '#1f2937',
                        border: '1px solid #374151',
                        borderRadius: 8,
                        fontSize: 12,
                        color: '#fff',
                        padding: '6px 10px',
                      }}
                      itemStyle={{ color: '#fff' }}
                      labelStyle={{ color: '#9CA3AF' }}
                      formatter={(value: number, _name, entry) => [
                        `${value}`,
                        entry?.payload?.name ?? '',
                      ]}
                      separator=": "
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2">
                {protocolData.map((item, i) => (
                  <div key={item.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: protocolColors[i % protocolColors.length] }}
                    />
                    <span className="text-muted flex-1">{item.name}</span>
                    <span className="text-white font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 text-muted-dark text-sm">
              No data yet. Upload pcap files to see stats.
            </div>
          )}
        </div>

        {/* Recent Uploads */}
        <div className="rounded-xl bg-dark-700 border border-dark-600 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Recent Uploads</h3>
            <button
              onClick={() => navigate('/files')}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              View all <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="space-y-3">
            {recentFiles.length === 0 ? (
              <p className="text-xs text-muted-dark text-center py-8">No files uploaded yet</p>
            ) : (
              recentFiles.map((file) => (
                <div
                  key={file.id}
                  onClick={() => navigate(`/pcap/${file.id}`)}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-dark-600/50 cursor-pointer transition-colors group"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <FileText size={16} className="text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate group-hover:text-primary transition-colors">
                      {file.name}
                    </p>
                    <p className="text-[10px] text-muted-dark">
                      {formatSize(file.size)} · {timeAgo(file.upload_time)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Activity Log */}
        <div className="rounded-xl bg-dark-700 border border-dark-600 p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {activities.length === 0 ? (
              <p className="text-xs text-muted-dark text-center py-8">No recent activity</p>
            ) : (
              activities.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start gap-3 pb-3 border-b border-dark-600/50 last:border-0"
                >
                  <div className="w-7 h-7 rounded-full bg-dark-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Clock size={12} className="text-muted-dark" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-white">{a.description}</p>
                    <p className="text-[10px] text-muted-dark mt-0.5">{timeAgo(a.created_at)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
