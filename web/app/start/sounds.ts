// Phone sounds synthesised with WebAudio (no recorded audio). The context is created inside the submit tap,
// so every sound after it meets the browsers' autoplay rules.
let ctx: AudioContext | null = null;
let ringTimer: ReturnType<typeof setInterval> | null = null;

export function unlock(): AudioContext | null {
  try {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = ctx ?? new C();
    void ctx.resume();
  } catch { ctx = null; }
  return ctx;
}

function note(freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine") {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(at); o.stop(at + dur + 0.05);
}

// A bright marimba-like figure with a reflective rhythm: two quick rising notes, a pause, an answer.
function ringOnce() {
  if (!ctx) return;
  const t = ctx.currentTime + 0.02;
  const figure: [number, number][] = [[0, 1046.5], [0.14, 1318.5], [0.28, 1568], [0.62, 1318.5], [0.76, 1568], [0.9, 2093]];
  for (const [d, f] of figure) { note(f, t + d, 0.45, 0.16); note(f * 2, t + d, 0.18, 0.04, "triangle"); }
}

export function startRing() {
  stopRing();
  ringOnce();
  ringTimer = setInterval(ringOnce, 2000);
}

export function stopRing() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
}

export function tick() {
  if (!ctx) return;
  note(1800, ctx.currentTime + 0.01, 0.05, 0.12, "square");
}

// The end-call tone: three short falling beeps.
export function endTone() {
  if (!ctx) return;
  const t = ctx.currentTime + 0.02;
  [[0, 620], [0.18, 520], [0.36, 420]].forEach(([d, f]) => note(f, t + d, 0.14, 0.14));
}
