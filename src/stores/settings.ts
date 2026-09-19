import { create } from "zustand";
import { api, ProviderProfile } from "../lib/tauri";

interface SettingsState {
  providers: ProviderProfile[];
  activeProviderId: number | null;
  modalOpen: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: (p: ProviderProfile) => Promise<ProviderProfile>;
  remove: (id: number) => Promise<void>;
  activate: (id: number) => Promise<void>;
  open: () => void;
  close: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  providers: [],
  activeProviderId: null,
  modalOpen: false,
  error: null,
  load: async () => {
    try {
      const providers = await api.listProviders();
      // Rust 侧未暴露 active 查询命令：激活态为前端会话内存态，失效时回落为无激活
      const cur = get().activeProviderId;
      set({
        providers,
        error: null,
        activeProviderId: cur != null && providers.some((p) => p.id === cur) ? cur : null,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },
  save: async (p) => {
    const saved = await api.saveProvider(p);
    await get().load();
    return saved;
  },
  remove: async (id) => {
    await api.deleteProvider(id);
    if (get().activeProviderId === id) set({ activeProviderId: null });
    await get().load();
  },
  activate: async (id) => {
    await api.setActiveProvider(id);
    set({ activeProviderId: id });
    await get().load();
  },
  open: () => set({ modalOpen: true }),
  close: () => set({ modalOpen: false }),
}));
