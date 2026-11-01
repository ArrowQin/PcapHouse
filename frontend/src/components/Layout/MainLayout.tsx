import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useUIStore } from '../../stores/uiStore';

const MainLayout: React.FC = () => {
  const { sidebarCollapsed } = useUIStore();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-dark-900">
      <Sidebar />

      {/* Main Content — fills viewport, no outer scrollbar.
          Each page decides how to lay out its own scrollable regions. */}
      <main
        className={`flex-1 min-w-0 h-screen overflow-hidden transition-all duration-300 ${
          sidebarCollapsed ? 'ml-[68px]' : 'ml-[240px]'
        }`}
      >
        <div className="h-full p-6 overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default MainLayout;
