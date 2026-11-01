// Sons dos lances. Primeiro tenta tocar pelo sistema (Rust: pw-play/paplay, com arquivos trocáveis na pasta de sons);
// se isso não existir, usa WebAudio sintetizado. Ligar/desligar em Aparência.
import { prefs } from "./look.js";

let ctx = null, master = null, lastAt = 0, noiseBuf = null;
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination); } catch { ctx = null; return null; }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}
function noise(c) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.3), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
// toque curto: seno que cai de f0 para f1 com envelope rápido
function tone(c, t, f0, f1, dur, vol, type = "sine") {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
// "clac" de madeira: rajada de ruído filtrada
function click(c, t, freq, dur, vol) {
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noise(c);
  f.type = "bandpass"; f.frequency.value = freq; f.Q.value = 1.4;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t); s.stop(t + dur + 0.02);
}
const KINDS = { // alternativa suave (madeira macia + sinos), igual em espírito aos sons gerados pelo Rust
  move: (c, t) => { click(c, t, 1100, 0.03, 0.5); tone(c, t, 380, 300, 0.09, 0.5); tone(c, t, 910, 700, 0.05, 0.12); },
  capture: (c, t) => { click(c, t, 900, 0.05, 0.8); tone(c, t, 300, 220, 0.14, 0.65); tone(c, t + 0.034, 430, 330, 0.08, 0.3); },
  castle: (c, t) => { KINDS.move(c, t); KINDS.move(c, t + 0.12); },
  check: (c, t) => { KINDS.move(c, t); tone(c, t + 0.07, 784, 784, 0.3, 0.2); },
  end: (c, t) => { [[523, 0], [392, 0.2], [262, 0.42]].forEach(([f, d]) => tone(c, t + d, f, f, 0.6, 0.3)); },
  ok: (c, t) => { tone(c, t, 659, 659, 0.14, 0.3); tone(c, t + 0.085, 880, 880, 0.2, 0.3); },
  bad: (c, t) => { tone(c, t, 170, 150, 0.22, 0.45); },
};
export function play(kind) {
  if (!prefs.sound) return;
  const now = performance.now();
  if (now - lastAt < 35 && kind !== "end") return; // navegação rápida não vira metralhadora
  lastAt = now;
  if (native !== false && window.__TAURI__?.core) {
    window.__TAURI__.core.invoke("sound_play", { kind }).then((ok) => { if (!ok) { native = false; web(kind); } else native = true; }).catch(() => { native = false; web(kind); });
    return;
  }
  web(kind);
}
let native = null; // null = ainda não sabemos; false = o sistema não tem player de áudio
function web(kind) {
  const c = audio();
  if (!c) return;
  try { KINDS[kind](c, c.currentTime + 0.005); } catch {}
}
// som de um lance, deduzido da diferença entre as duas posições (mapas casa → peça)
export function moveSound(prev, next, moves, check) {
  if (!prefs.sound) return;
  const n = (m) => Object.keys(m).length;
  const kind = check ? "check" : moves.length === 2 ? "castle" : n(next) < n(prev) ? "capture" : "move";
  play(kind);
}
