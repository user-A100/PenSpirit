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
      // 列表与激活态并发读；激活态以落库值为准（修 T5 遗留：重启后看不到哪个在用），
      // 后端返回的 id 已不存在时回落为无激活
      const [providers, active] = await Promise.all([api.listProviders(), api.getActiveProvider()]);
      set({
        providers,
        error: null,
        activeProviderId: active != null && providers.some((p) => p.id === active) ? active : null,
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
