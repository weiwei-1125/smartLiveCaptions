import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";

export { buildAccelerator } from "../config/accelerator";

/** The saved global mute hotkey accelerator ("" = none configured). */
export async function getSavedHotkey(): Promise<string> {
  return await invoke<string>("get_hotkey");
}

/** Persist the chosen accelerator ("" clears it). */
export async function saveHotkey(accel: string): Promise<void> {
  await invoke("set_hotkey", { hotkey: accel });
}

/**
 * Register a global hotkey; the handler fires on key-DOWN only (the plugin emits both
 * Pressed and Released). Throws if the OS rejects it — typically because another app
 * already holds it globally — which the caller surfaces as a conflict.
 */
export async function registerMuteHotkey(accel: string, onTrigger: () => void): Promise<void> {
  await register(accel, (event) => {
    if (event.state === "Pressed") onTrigger();
  });
}

/** Unregister an accelerator if it's currently registered (no-op/ignored otherwise). */
export async function unregisterHotkey(accel: string): Promise<void> {
  try {
    if (accel && (await isRegistered(accel))) await unregister(accel);
  } catch {
    /* already gone — ignore */
  }
}
