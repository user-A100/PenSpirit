import { create } from "zustand";
import { api, ProviderProfile } from "../lib/tauri";
import { errMsg } from "../lib/errors";

interface SettingsState {
  providers: ProviderProfile[];
  activeProviderId: number | null;
  modalOpen: boolean;
  /** 打开时直达的 tab（如「去设置服务商」→ "provider"）；消费后由弹窗自行忽略 */
  initialTab: string | null;
  error: string | null;
  load: () => Promise<void>;
  save: (p: ProviderProfile) => Promise<ProviderProfile>;
  remove: (id: number) => Promise<void>;
  activate: (id: number) => Promise<void>;
  /** 打开设置；tab 可选（作为 onClick 处理器直接传入时会收到事件对象，此时忽略） */
  open: (tab?: unknown) => void;
  close: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  providers: [],
  activeProviderId: null,
  modalOpen: false,
  initialTab: null,
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
      set({ error: errMsg(e) });
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
  open: (tab) => set({ modalOpen: true, initialTab: typeof tab === "string" ? tab : null }),
  close: () => set({ modalOpen: false }),
}));
