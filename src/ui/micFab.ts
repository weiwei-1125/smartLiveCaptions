// Floating mic button (FAB): the primary, always-reachable control for toggling
// capture. Lives on <body> (outside the overlay's re-rendered root) so it stays put,
// clicks never get lost, and its glow animation isn't restarted by caption re-renders.
// Off = red slashed mic (a visible "you're muted" reminder); on = subtle; on + your
// voice detected = green pulsing glow (the activity indicator, consolidated here).

const ICON_MIC =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 11v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';
const ICON_MIC_OFF =
  '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v2a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-1m14 0v1a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="22"/></svg>';

export interface MicFab {
  el: HTMLButtonElement;
  setMicOn(on: boolean): void;
  setVoiceActive(active: boolean): void;
  destroy(): void;
}

export function createMicFab(onToggle: () => void): MicFab {
  const el = document.createElement("button");
  el.className = "mic-fab on";
  el.type = "button";
  el.setAttribute("data-action", "toggle-mic");
  el.addEventListener("click", () => onToggle());
  document.body.appendChild(el);

  let micOn = true;
  let voiceActive = false;

  const applyActive = () => el.classList.toggle("active", micOn && voiceActive);
  const applyMic = () => {
    el.classList.toggle("on", micOn);
    el.classList.toggle("off", !micOn);
    el.innerHTML = micOn ? ICON_MIC : ICON_MIC_OFF;
    el.title = micOn ? "收音中（点击暂停）" : "已静音（点击恢复）";
    applyActive();
  };
  applyMic(); // initial paint (on)

  return {
    el,
    setMicOn(on) {
      micOn = on;
      if (!on) voiceActive = false; // muted → no activity glow
      applyMic();
    },
    setVoiceActive(active) {
      voiceActive = active;
      applyActive(); // cheap: just toggles the glow class, no icon rebuild
    },
    destroy() {
      el.remove();
    },
  };
}
