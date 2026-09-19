import { api } from "./tauri";

// 通用 KV：M3-T1 的 setting_get/set（SQLite settings 表）之上加一层 JSON 编解码。
// 阅读进度（read:progress:{bookId}）等前端杂项状态走这里，坏值一律回 null。

/** 读：setting_get 的原始串 JSON.parse；无记录或坏 JSON 返回 null */
export const kvGet = async <T>(key: string): Promise<T | null> => {
  const raw = await api.settingGet(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

/** 写：任意可 JSON 序列化的值落 setting_set */
export const kvSet = async (key: string, value: unknown): Promise<void> => {
  await api.settingSet(key, JSON.stringify(value));
};
