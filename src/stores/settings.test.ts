import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => {
  const providers = [
    { id: 1, name: "服务A", base_url: "https://a.example.com", api_key: "sk-1", model: "m1", max_tokens: 4096, temperature: 0.7 },
    { id: 2, name: "服务B", base_url: "https://b.example.com", api_key: "sk-2", model: "m2", max_tokens: 2048, temperature: 0.5 },
  ];
  return {
    api: {
      listProviders: vi.fn().mockResolvedValue(providers),
      saveProvider: vi.fn().mockResolvedValue({ id: 3, name: "新服务", base_url: "https://c", api_key: "sk-3", model: "m3", max_tokens: 1024, temperature: 0.6 }),
      deleteProvider: vi.fn().mockResolvedValue(undefined),
      setActiveProvider: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import { api } from "../lib/tauri";
import { useSettings } from "./settings";

describe("settings store", () => {
  beforeEach(() => useSettings.setState({ providers: [], activeProviderId: null, modalOpen: false, error: null }));

  it("load 填充服务商列表", async () => {
    await useSettings.getState().load();
    expect(useSettings.getState().providers).toHaveLength(2);
    expect(useSettings.getState().error).toBeNull();
  });

  it("save 保存后自动 reload", async () => {
    await useSettings.getState().load();
    expect(api.listProviders).toHaveBeenCalledTimes(1);
    const saved = await useSettings.getState().save({ id: 0, name: "新服务", base_url: "https://c", api_key: "sk-3", model: "m3", max_tokens: 1024, temperature: 0.6 });
    expect(api.saveProvider).toHaveBeenCalledTimes(1);
    expect(api.listProviders).toHaveBeenCalledTimes(2); // save 后 reload 被调
    expect(saved.id).toBe(3);
    expect(useSettings.getState().providers).toHaveLength(2);
  });

  it("activate 更新 activeProviderId 并写后端", async () => {
    await useSettings.getState().load();
    await useSettings.getState().activate(2);
    expect(api.setActiveProvider).toHaveBeenCalledWith(2);
    expect(useSettings.getState().activeProviderId).toBe(2);
  });

  it("remove 删除后 reload；删除激活项时清除激活态", async () => {
    await useSettings.getState().load();
    await useSettings.getState().activate(1);
    await useSettings.getState().remove(1);
    expect(api.deleteProvider).toHaveBeenCalledWith(1);
    expect(api.listProviders).toHaveBeenCalledTimes(3); // load + activate 后 reload + remove 后 reload
    expect(useSettings.getState().activeProviderId).toBeNull();
  });

  it("open/close 切换模态开关", () => {
    useSettings.getState().open();
    expect(useSettings.getState().modalOpen).toBe(true);
    useSettings.getState().close();
    expect(useSettings.getState().modalOpen).toBe(false);
  });
});
