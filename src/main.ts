import "./styles.css";
import { AudioCapture } from "./audio/capture";
import { EnergyVad } from "./audio/vad";
import { CaptionStore } from "./state/captionStore";
import { renderOverlay } from "./ui/overlay";
import { startTranscription, pushAudio, onTranscript } from "./services/transcription";
import { translate } from "./services/translation";
import { langPairForMode } from "./config/langPrompts";

const root = document.getElementById("app")!;
const store = new CaptionStore({ maxHistory: 5 });
store.subscribe(() => renderOverlay(root, store));

const vad = new EnergyVad({ threshold: 600, hangoverFrames: 8 });
const capture = new AudioCapture();
const pair = langPairForMode("practice"); // zh -> en

async function main() {
  await startTranscription(pair.source);

  await onTranscript(async (m) => {
    if (m.kind === "partial") {
      store.setPartial(m.text, pair.source);
    } else if (m.kind === "final" && m.text.trim()) {
      const id = store.commit(m.text, pair.source);
      try {
        const en = await translate(m.text, pair);
        store.setTranslation(id, en);
      } catch (e) {
        store.setTranslation(id, `⚠️ 翻译失败: ${e}`);
      }
    }
  });

  await capture.start((frame) => {
    if (vad.process(frame)) {
      void pushAudio(frame);
    }
  });
}

main().catch((e) => {
  root.innerHTML = `<div class="bar"><div class="orig en">启动失败: ${e}</div></div>`;
});
