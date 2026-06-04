import { invoke } from "@tauri-apps/api/core";

/** True when a non-empty Soniox key is configured (per-user saved config or dev fallback). */
export async function hasApiKey(): Promise<boolean> {
  return await invoke<boolean>("has_api_key");
}

/** The currently saved key (empty string if none) — used to prefill the settings panel. */
export async function getApiKey(): Promise<string> {
  return await invoke<string>("get_api_key");
}

/** Persist the user's own key to the per-user app config dir and apply it live. */
export async function setApiKey(key: string): Promise<void> {
  await invoke("set_api_key", { key });
}
