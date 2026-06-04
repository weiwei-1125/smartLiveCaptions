// Dev-only prototype: stream the mic to Soniox real-time STT (+ two-way zh<->en translation)
// to validate the "type while you speak + live revision into sentences" experience.
// Reads the key from VITE_SONIOX_API_KEY (.env.local, gitignored). NOT part of the shipped app.
import { AudioCapture } from "../audio/capture";

const KEY = (import.meta as unknown as { env: Record<string, string | undefined> }).env
  .VITE_SONIOX_API_KEY;
const WS_URL = "wss://stt-rt.soniox.com/transcribe-websocket";

const toggleBtn = document.getElementById("toggle") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const origEl = document.getElementById("orig")!;
const transEl = document.getElementById("transText")!;

const capture = new AudioCapture();
let ws: WebSocket | null = null;
let running = false;

// Committed (is_final) text grows and never changes; pending (non-final) is the live,
// revisable tail that is replaced on every message.
let origCommitted = "";
let transCommitted = "";

function setStatus(s: string, cls = "") {
  statusEl.textContent = s;
  statusEl.className = cls;
}
function esc(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
function paint(origPending: string, transPending: string) {
  origEl.innerHTML = esc(origCommitted) + `<span class="pending">${esc(origPending)}</span>`;
  transEl.innerHTML = esc(transCommitted) + `<span class="pending">${esc(transPending)}</span>`;
}

interface Token {
  text?: string;
  is_final?: boolean;
  translation_status?: string;
}
function handleTokens(tokens: Token[]) {
  let origPending = "";
  let transPending = "";
  for (const t of tokens) {
    const text = t.text ?? "";
    const isTrans = t.translation_status === "translation"; // verified value; everything else = original
    if (t.is_final) {
      if (isTrans) transCommitted += text;
      else origCommitted += text;
    } else if (isTrans) transPending += text;
    else origPending += text;
  }
  paint(origPending, transPending);
}

async function start() {
  if (!KEY) {
    setStatus("缺少 Soniox key：请在 .env.local 设 VITE_SONIOX_API_KEY 后重启 vite", "err");
    return;
  }
  origCommitted = "";
  transCommitted = "";
  paint("", "");
  setStatus("连接中…", "pending");

  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  ws.onopen = async () => {
    // First message: the JSON config (api_key lives here, not in a header).
    ws!.send(
      JSON.stringify({
        api_key: KEY,
        model: "stt-rt-v4",
        audio_format: "pcm_s16le",
        sample_rate: 24000,
        num_channels: 1,
        language_hints: ["zh", "en"],
        enable_language_identification: true,
        enable_endpoint_detection: true,
        translation: { type: "two_way", language_a: "zh", language_b: "en" },
      }),
    );
    setStatus("● 正在听…（说话试试）", "ok");
    try {
      await capture.start((frame) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)); // raw s16le PCM
        }
      });
    } catch (e) {
      setStatus(`麦克风错误: ${e}`, "err");
    }
  };

  ws.onmessage = (ev) => {
    let msg: { tokens?: Token[]; finished?: boolean; error_code?: unknown; error_message?: string };
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      console.warn("[soniox] non-JSON message", ev.data);
      return;
    }
    console.log("[soniox]", msg);
    if (msg.error_code != null || msg.error_message) {
      setStatus(`Soniox 错误: ${msg.error_code ?? ""} ${msg.error_message ?? ""}`, "err");
      return;
    }
    if (Array.isArray(msg.tokens) && msg.tokens.length) handleTokens(msg.tokens);
    if (msg.finished) {
      setStatus("已结束（已收尾定稿）", "");
      cleanup();
    }
  };

  ws.onerror = () => setStatus("WebSocket 连接出错", "err");
  ws.onclose = (e) => {
    if (running) setStatus(`连接已关闭 (code ${e.code})`, "");
  };

  running = true;
  toggleBtn.textContent = "⏹ 停止";
}

function stop() {
  // Signal end-of-audio with an empty frame so the server flushes final tokens, THEN closes.
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send("");
    } catch {
      /* ignore */
    }
  }
  capture.stop();
  running = false;
  toggleBtn.textContent = "▶ 开始";
  setStatus("停止中…（等待定稿）", "pending");
}
function cleanup() {
  capture.stop();
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  ws = null;
  running = false;
  toggleBtn.textContent = "▶ 开始";
}

toggleBtn.addEventListener("click", () => (running ? stop() : void start()));
