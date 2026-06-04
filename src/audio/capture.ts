export type FrameHandler = (frame: Int16Array) => void;

export class AudioCapture {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: ScriptProcessorNode;

  async start(onFrame: FrameHandler): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    // Capture at 24 kHz to match the rate declared in the Soniox session config
    // (sample_rate: 24000 in soniox.rs); the raw PCM16 frames stream straight up.
    this.ctx = new AudioContext({ sampleRate: 24000 });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(2048, 1, 1);
    this.node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0); // Float32 [-1,1]
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      onFrame(pcm);
    };
    src.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  stop(): void {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
  }
}
