// "断句节奏" — how long Soniox waits after speech pauses before locking a sentence boundary
// (max_endpoint_delay_ms). Lower = snappier sentences (more fragments); higher = waits for
// fuller sentences (steadier, slightly later). The user picks one; the choice is remembered.

export type Pace = "fast" | "balanced" | "full";

export const PACE_DELAY_MS: Record<Pace, number> = {
  fast: 1000,
  balanced: 2000,
  full: 3000,
};

export const DEFAULT_PACE: Pace = "balanced";

/** Topbar segmented control, left→right. `title` is the hover tooltip. */
export const PACE_SEGMENTS: { pace: Pace; label: string; title: string }[] = [
  { pace: "fast", label: "快", title: "断句更快——句子更短、出句更及时" },
  { pace: "balanced", label: "平衡", title: "平衡（推荐）——兼顾及时与完整" },
  { pace: "full", label: "整句", title: "整句——多等一会儿，凑成更完整的句子" },
];

export function clampPace(s: string | null): Pace {
  return s === "fast" || s === "balanced" || s === "full" ? s : DEFAULT_PACE;
}
