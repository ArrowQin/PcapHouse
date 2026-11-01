import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './components/Layout/MainLayout';
import Dashboard from './pages/Dashboard';
import FilesPage from './pages/FilesPage';
import FavoritesPage from './pages/FavoritesPage';
import TagsPage from './pages/TagsPage';
import CategoriesPage from './pages/CategoriesPage';
import ProtocolsPage from './pages/ProtocolsPage';
import RecentPage from './pages/RecentPage';
import PcapDetailPage from './pages/PcapDetailPage';
import GeneratorPage from './pages/GeneratorPage';
import DecapsulatePage from './pages/DecapsulatePage';
import BackupPage from './pages/BackupPage';
import SharePage from './pages/SharePage';
import NotFoundPage from './pages/NotFoundPage';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/recent" element={<RecentPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/protocols" element={<ProtocolsPage />} />
          <Route path="/generator" element={<GeneratorPage />} />
          <Route path="/tools/decapsulate" element={<DecapsulatePage />} />
          <Route path="/settings/backup" element={<BackupPage />} />
          <Route path="/settings/share" element={<SharePage />} />
          <Route path="/pcap/:id" element={<PcapDetailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
