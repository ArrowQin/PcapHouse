import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderOpen,
  Star,
  Clock,
  Tags,
  FolderTree,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  Radar,
  Globe,
  Layers,
  Cloud,
  Share2,
} from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { generatorApi } from '../../api/generator';
import { SupportedProtocol } from '../../types';

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  path: string;
  // Optional query string (e.g. "?protocol=http") used to build the full link
  // and to determine whether the current location matches this item.
  query?: string;
  group: string;
}

const staticNavItems: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} />, path: '/', group: 'OVERVIEW' },
  { key: 'files', label: 'All Files', icon: <FolderOpen size={20} />, path: '/files', group: 'FILES' },
  { key: 'favorites', label: 'Favorites', icon: <Star size={20} />, path: '/favorites', group: 'FILES' },
  { key: 'recent', label: 'Recent Uploads', icon: <Clock size={20} />, path: '/recent', group: 'FILES' },
  { key: 'categories', label: 'Categories', icon: <FolderTree size={20} />, path: '/categories', group: 'MANAGE' },
  { key: 'tags', label: 'Tags', icon: <Tags size={20} />, path: '/tags', group: 'MANAGE' },
  { key: 'protocols', label: 'Protocols', icon: <Radar size={20} />, path: '/protocols', group: 'MANAGE' },
  // TOOLS group collects pcap post-processing utilities. The first entry
  // is Decapsulate (strip Geneve/VXLAN); add future tools here as they
  // land — the group renders automatically so no wiring is needed.
  { key: 'tool-decapsulate', label: 'Decapsulate', icon: <Layers size={20} />, path: '/tools/decapsulate', group: 'TOOLS' },
  // SETTINGS group: app-level configuration that's not tied to a single
  // entity (files/tags/categories). Backup → Tencent Cloud COS is the
  // first entry; other cross-cutting settings will land here too.
  { key: 'settings-backup', label: 'Backup', icon: <Cloud size={20} />, path: '/settings/backup', group: 'SETTINGS' },
  { key: 'settings-share', label: 'Share', icon: <Share2 size={20} />, path: '/settings/share', group: 'SETTINGS' },
];

const groups = ['OVERVIEW', 'FILES', 'MANAGE', 'GENERATOR', 'TOOLS', 'SETTINGS'];

const Sidebar: React.FC = () => {
  const { sidebarCollapsed, toggleSidebar, theme, toggleTheme } = useUIStore();
  const location = useLocation();
  const isDark = theme === 'dark';

  const [protocols, setProtocols] = useState<SupportedProtocol[]>([]);

  useEffect(() => {
    generatorApi
      .getSupportedProtocols()
      .then((r) => setProtocols(r.data))
      .catch(console.error);
  }, []);

  // Build the Generator group dynamically: one entry per available protocol.
  const available = protocols.filter((p) => p.available);
  const generatorItems: NavItem[] = (available.length > 0
    ? available
    : [{ name: 'http', label: 'HTTP', description: '', available: true } as SupportedProtocol]
  ).map((p) => ({
    key: `gen-${p.name}`,
    label: p.label,
    icon: <Globe size={20} />,
    path: '/generator',
    query: `?protocol=${p.name}`,
    group: 'GENERATOR',
  }));

  const navItems: NavItem[] = [...staticNavItems, ...generatorItems];

  const currentProtocol = new URLSearchParams(location.search).get('protocol');

  const isItemActive = (item: NavItem): boolean => {
    if (item.path === '/generator') {
      if (location.pathname !== '/generator') return false;
      const want = item.query ? new URLSearchParams(item.query).get('protocol') : null;
      if (!want) return !currentProtocol;
      // Treat missing query as the first generator item so one is always active.
      if (!currentProtocol) {
        return item === generatorItems[0];
      }
      return want === currentProtocol;
    }
    return (
      location.pathname === item.path ||
      (item.path !== '/' && location.pathname.startsWith(item.path))
    );
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-full z-30 flex flex-col bg-dark-800 border-r border-dark-600/50 transition-all duration-300 ease-in-out ${
        sidebarCollapsed ? 'w-[68px]' : 'w-[240px]'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-dark-600/50">
        <div className="flex items-center gap-3">
          <img
            src="/favicon.svg"
            alt="PcapHouse"
            className="w-9 h-9 flex-shrink-0"
          />
          {!sidebarCollapsed && (
            <span className="text-lg font-bold text-white whitespace-nowrap">
              PcapHouse
            </span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {groups.map((group) => {
          const items = navItems.filter((item) => item.group === group);
          if (items.length === 0) return null;

          return (
            <div key={group} className="mb-6">
              {!sidebarCollapsed && (
                <div className="text-[11px] font-semibold text-muted-dark uppercase tracking-wider px-3 mb-2">
                  {group}
                </div>
              )}
              <div className="space-y-1">
                {items.map((item) => {
                  const isActive = isItemActive(item);

                  return (
                    <NavLink
                      key={item.key}
                      to={`${item.path}${item.query ?? ''}`}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative ${
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted hover:text-white hover:bg-dark-600/50'
                      }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-primary rounded-r-full" />
                      )}
                      <span className={`flex-shrink-0 ${isActive ? 'text-primary' : 'text-muted group-hover:text-white'}`}>
                        {item.icon}
                      </span>
                      {!sidebarCollapsed && <span>{item.label}</span>}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer Actions: Theme toggle + Collapse */}
      <div className="p-3 border-t border-dark-600/50">
        <div
          className={`flex items-center ${
            sidebarCollapsed ? 'flex-col gap-1' : 'gap-1'
          }`}
        >
          <button
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex-1 flex items-center justify-center py-2 rounded-lg text-muted hover:text-white hover:bg-dark-600/50 transition-colors"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex-1 flex items-center justify-center py-2 rounded-lg text-muted hover:text-white hover:bg-dark-600/50 transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
