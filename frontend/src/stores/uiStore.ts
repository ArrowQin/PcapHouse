import { create } from 'zustand';
import { ViewMode } from '../types';

export type Theme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'pcaphouse-theme';

const readInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return 'dark';
};

const applyTheme = (theme: Theme) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // ignore write errors (e.g. private mode)
  }
};

// Apply theme ASAP so first paint matches user preference
applyTheme(readInitialTheme());

interface UIStore {
  sidebarCollapsed: boolean;
  viewMode: ViewMode;
  searchKeyword: string;
  globalLoading: boolean;
  theme: Theme;
  toggleSidebar: () => void;
  setViewMode: (mode: ViewMode) => void;
  setSearchKeyword: (keyword: string) => void;
  setGlobalLoading: (loading: boolean) => void;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: false,
  viewMode: 'list',
  searchKeyword: '',
  globalLoading: false,
  theme: readInitialTheme(),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchKeyword: (keyword) => set({ searchKeyword: keyword }),
  setGlobalLoading: (loading) => set({ globalLoading: loading }),

  toggleTheme: () =>
    set((state) => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return { theme: next };
    }),

  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));
