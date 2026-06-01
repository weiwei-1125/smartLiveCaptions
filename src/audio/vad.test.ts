import { describe, it, expect } from "vitest";
import { EnergyVad } from "./vad";

function frame(amplitude: number, len = 320): Int16Array {
  const f = new Int16Array(len);
  for (let i = 0; i < len; i++) f[i] = amplitude;
  return f;
}

describe("EnergyVad", () => {
  it("reports silence for near-zero frames", () => {
    const vad = new EnergyVad({ threshold: 500, hangoverFrames: 3 });
    expect(vad.process(frame(0))).toBe(false);
  });

  it("reports speech when energy exceeds threshold", () => {
    const vad = new EnergyVad({ threshold: 500, hangoverFrames: 3 });
    expect(vad.process(frame(2000))).toBe(true);
  });

  it("keeps speech active during hangover after a loud frame", () => {
    const vad = new EnergyVad({ threshold: 500, hangoverFrames: 2 });
    vad.process(frame(2000));      // speech
    expect(vad.process(frame(0))).toBe(true);  // hangover 1
    expect(vad.process(frame(0))).toBe(true);  // hangover 2
    expect(vad.process(frame(0))).toBe(false); // hangover expired
  });
});
