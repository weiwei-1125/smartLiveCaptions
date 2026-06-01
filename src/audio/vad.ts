export interface VadOptions {
  threshold: number;       // RMS amplitude threshold (PCM16 units)
  hangoverFrames: number;  // frames of speech to hold after energy drops
}

export class EnergyVad {
  private remaining = 0;
  constructor(private opts: VadOptions) {}

  /** Returns true if this frame should be treated as speech. */
  process(frame: Int16Array): boolean {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / Math.max(1, frame.length));
    if (rms >= this.opts.threshold) {
      this.remaining = this.opts.hangoverFrames;
      return true;
    }
    if (this.remaining > 0) {
      this.remaining--;
      return true;
    }
    return false;
  }
}
