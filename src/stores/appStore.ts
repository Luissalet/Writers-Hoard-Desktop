import { create } from 'zustand';

interface AppState {
  sidebarOpen: boolean;
  searchOpen: boolean;
  currentProjectId: string | null;
  showEngineManager: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSearch: () => void;
  setSearchOpen: (open: boolean) => void;
  setCurrentProject: (id: string | null) => void;
  setShowEngineManager: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  searchOpen: false,
  currentProjectId: null,
  showEngineManager: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setCurrentProject: (id) => set({ currentProjectId: id }),
  setShowEngineManager: (open) => set({ showEngineManager: open }),
}));
