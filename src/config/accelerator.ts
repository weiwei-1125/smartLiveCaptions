// Convert a keyboard event into a Tauri global-shortcut accelerator string
// (e.g. "Ctrl+Alt+M", "Pause", "F8"). Pure — no Tauri imports — so it's unit-testable.

export interface KeyEventLike {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  code: string; // KeyboardEvent.code, e.g. "KeyM", "Digit1", "F8", "Pause"
}

interface MappedKey {
  name: string;
  needsMod: boolean; // letters/digits/space are too greedy to register alone
}

function mapCode(code: string): MappedKey | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return { name: letter[1], needsMod: true };
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return { name: digit[1], needsMod: true };
  const fkey = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (fkey) return { name: "F" + fkey[1], needsMod: false };
  switch (code) {
    case "Space":
      return { name: "Space", needsMod: true };
    case "Pause":
      return { name: "Pause", needsMod: false };
    case "Insert":
      return { name: "Insert", needsMod: false };
    case "ScrollLock":
      return { name: "ScrollLock", needsMod: false };
    default:
      // Modifiers themselves, Escape/Enter/Tab, arrows, etc. → not a valid hotkey key.
      return null;
  }
}

/** Returns the accelerator string, or null if the combo is incomplete/disallowed. */
export function buildAccelerator(e: KeyEventLike): string | null {
  const key = mapCode(e.code);
  if (!key) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  if (mods.length === 0 && key.needsMod) return null; // a bare letter/digit is too greedy
  return [...mods, key.name].join("+");
}
