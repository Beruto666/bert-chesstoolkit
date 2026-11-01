// Cliente UCI (Stockfish): inicia a engine pelo Rust, fila de buscas, avaliação em % e cache.
import { ls } from "./util.js";

const T = window.__TAURI__;
const invoke = (...a) => T.core.invoke(...a);

export const state = { name: "", path: "", ready: false, opts: {} }; // opts: opções UCI anunciadas pelo programa
let starting = null, listening = false, waiters = [], busy = null, queued = null, curMulti = 0, curElo = null;
let opts = { threads: 2, hash: 128 };

// ---------- avaliação ----------
// Todas as avaliações ficam do ponto de vista das BRANCAS: { cp } ou { mate } (+ depth).
export const winPct = (e) => e.mate != null
  ? (e.mate > 0 ? 100 : e.mate < 0 ? 0 : 50)
  : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-100000, Math.min(100000, e.cp)))) - 1);
export function evalText(e) {
  if (!e) return "";
  if (e.final) return e.draw ? "½" : e.cp > 0 ? "1-0" : "0-1";
  if (e.mate != null) return `${e.mate < 0 ? "-" : ""}#${Math.abs(e.mate)}`;
  const v = e.cp / 100;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
}
export function terminalEval(chess) {
  if (chess.isCheckmate()) return { cp: chess.turn() === "b" ? 100000 : -100000, final: true, depth: 99 };
  if (chess.isDraw() || chess.isStalemate()) return { cp: 0, final: true, draw: true, depth: 99 };
  return null;
}
export const toWhite = (fen, l) => {
  const s = fen.split(" ")[1] === "b" ? -1 : 1;
  return l.mate != null ? { mate: l.mate * s, depth: l.depth } : { cp: l.cp * s, depth: l.depth };
};
// perda de centipeões (para a "perda média"), limitada a ±1000
export const cpOf = (e) => e.mate != null ? (e.mate > 0 ? 1000 : -1000) : Math.max(-1000, Math.min(1000, e.cp));

// ---------- cache de avaliações (por posição) ----------
const key = (fen) => fen.split(" ").slice(0, 4).join(" ");
const cache = new Map();
try { for (const [k, cp, mate, depth] of JSON.parse(ls.get("evc") || "[]")) cache.set(k, mate != null ? { mate, depth } : { cp, depth }); } catch {}
let saveT = null;
export const cacheGet = (fen) => cache.get(key(fen)) || null;
export function cachePut(fen, e) {
  const k = key(fen), o = cache.get(k);
  if (o && o.depth > e.depth) return;
  cache.set(k, { ...(e.mate != null ? { mate: e.mate } : { cp: e.cp }), depth: e.depth, ...(e.final ? { final: true, draw: e.draw } : {}) });
  clearTimeout(saveT);
  saveT = setTimeout(cacheSave, 4000);
}
export function cacheSave() {
  const arr = [...cache.entries()].slice(-6000).map(([k, e]) => [k, e.cp ?? null, e.mate ?? null, e.depth]);
  ls.set("evc", JSON.stringify(arr));
}

// ---------- UCI ----------
function onLine(l) {
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i].test(l)) { const w = waiters.splice(i, 1)[0]; w.resolve(l); }
  }
  if (l.startsWith("id name ")) state.name = l.slice(8);
  else if (l.startsWith("option name ")) { // option name UCI_Elo type spin default 1320 min 1320 max 3190
    const m = l.match(/^option name (.+?) type (\w+)(?: default (\S*))?(?: min (-?\d+))?(?: max (-?\d+))?/);
    if (m) state.opts[m[1]] = { type: m[2], min: m[4] !== undefined ? Number(m[4]) : undefined, max: m[5] !== undefined ? Number(m[5]) : undefined };
  }
  if (!busy) return;
  if (l.startsWith("info ")) infoLine(l);
  else if (l.startsWith("bestmove")) done(l.split(" ")[1]);
}
const wait = (test, ms = 20000) => new Promise((resolve, reject) => {
  const w = { test, resolve };
  waiters.push(w);
  setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error("A engine não respondeu.")); } }, ms);
});
const send = (cmd) => invoke("engine_send", { cmd });

function parseInfo(l) {
  if (!l.includes(" score ") || !l.includes(" pv ") || l.includes("lowerbound") || l.includes("upperbound")) return null;
  const t = l.split(" ");
  const r = { depth: 0, mpv: 1, cp: null, mate: null, pv: [], nps: 0 };
  for (let i = 1; i < t.length; i++) {
    const w = t[i];
    if (w === "depth") r.depth = Number(t[++i]);
    else if (w === "multipv") r.mpv = Number(t[++i]);
    else if (w === "nps") r.nps = Number(t[++i]);
    else if (w === "score") { const k = t[++i], v = Number(t[++i]); if (k === "cp") r.cp = v; else if (k === "mate") r.mate = v; }
    else if (w === "pv") { r.pv = t.slice(i + 1); break; }
  }
  return r.cp == null && r.mate == null ? null : r;
}
function infoLine(l) {
  const r = parseInfo(l);
  if (!r) return;
  busy.lines[r.mpv] = r;
  const now = performance.now();
  if (now - busy.t > 120) { busy.t = now; busy.o.onInfo?.(busy.lines); }
}
function done(best) {
  const job = busy;
  busy = null;
  if (job) {
    if (!job.cancelled) job.o.onInfo?.(job.lines);
    job.o.onDone?.(job.lines, job.cancelled, undefined, best);
  }
  if (queued) run();
}
function run() {
  if (!queued) return;
  const job = queued;
  queued = null;
  busy = job;
  (async () => {
    try {
      const mp = job.o.multipv || 1;
      if (mp !== curMulti) { await send(`setoption name MultiPV value ${mp}`); curMulti = mp; }
      const want = state.opts.UCI_Elo ? job.o.elo || null : null; // força limitada (só se o motor tiver UCI_Elo)
      if (want !== curElo) {
        if (want) { await send("setoption name UCI_LimitStrength value true"); await send(`setoption name UCI_Elo value ${want}`); }
        else await send("setoption name UCI_LimitStrength value false");
        curElo = want;
      }
      if (job.cancelled) { busy = null; job.o.onDone?.(job.lines, true); run(); return; } // trocada antes de começar
      await send(`position fen ${job.fen}`);
      const lim = job.o.movetime ? `movetime ${job.o.movetime}` : job.o.depth && job.o.depth < 99 ? `depth ${job.o.depth}` : "infinite";
      await send(`go ${lim}`);
      if (job.cancelled) send("stop").catch(() => {}); // cancelada enquanto o "go" era enviado
    } catch (e) {
      busy = null;
      job.o.onDone?.(job.lines, true, e);
    }
  })();
}

// Inicia (ou reaproveita) a engine. Rejeita com Error("not-installed") se não houver nenhuma.
export function ensure(o = {}) {
  opts = { ...opts, ...o };
  if (state.ready) return Promise.resolve();
  if (starting) return starting;
  const p = (async () => {
    const path = await resolvePath();
    if (!path) throw new Error("not-installed");
    if (!listening) {
      await T.event.listen("engine-line", (e) => onLine(e.payload));
      await T.event.listen("engine-exit", () => { state.ready = false; busy = null; queued = null; });
      listening = true;
    }
    busy = null; queued = null; curMulti = 0; curElo = null;
    await invoke("engine_start", { path });
    state.path = path;
    state.opts = {};
    const u = wait((l) => l === "uciok");
    await send("uci");
    await u;
    await send(`setoption name Threads value ${opts.threads}`);
    await send(`setoption name Hash value ${opts.hash}`);
    const r = wait((l) => l === "readyok");
    await send("isready");
    await r;
    state.ready = true;
  })();
  starting = p;
  p.then(() => { starting = null; }, () => { starting = null; });
  return p;
}
export async function quit() {
  state.ready = false; busy = null; queued = null;
  try { await invoke("engine_stop"); } catch {}
}
export async function restart(o = {}) { await quit(); return ensure(o); }
// Pede um lance: devolve o "bestmove" (UCI) ou null se a busca foi cancelada.
export const bestMove = (fen, o) => new Promise((res) => search(fen, { multipv: 1, ...o, onDone: (lines, cancelled, err, best) => res(cancelled || err || !best || best === "(none)" ? null : best) }));

// Busca: o = { multipv, depth|movetime, onInfo(lines), onDone(lines, cancelled) }. Uma nova busca cancela a anterior.
export function search(fen, o) {
  const job = { fen, o, lines: {}, cancelled: false, t: 0 };
  if (queued) { queued.cancelled = true; queued.o.onDone?.({}, true); }
  queued = job;
  if (busy) { busy.cancelled = true; send("stop").catch(() => {}); } else run();
  return job;
}
export const searchOnce = (fen, o) => new Promise((res) => search(fen, { ...o, onDone: (lines, cancelled) => res(cancelled ? null : lines) }));
export const eloRange = () => state.opts.UCI_Elo && state.opts.UCI_LimitStrength ? { min: state.opts.UCI_Elo.min ?? 1320, max: state.opts.UCI_Elo.max ?? 3190 } : null;
export function stopSearch() {
  if (queued) { queued.cancelled = true; queued.o.onDone?.({}, true); queued = null; }
  if (busy) { busy.cancelled = true; send("stop").catch(() => {}); }
}

// ---------- caminhos / instalação ----------
async function resolvePath() {
  const cfg = await invoke("get_config");
  if (cfg.engine) return cfg.engine;
  const st = await invoke("engine_status");
  return st.managed || st.system || null;
}
export async function status() {
  const cfg = await invoke("get_config");
  const st = await invoke("engine_status");
  return { configured: cfg.engine || null, managed: st.managed, system: st.system, active: cfg.engine || st.managed || st.system || null };
}
export async function install(onProgress) {
  const un = await T.event.listen("engine-progress", (e) => onProgress?.(e.payload));
  try { return await invoke("engine_install"); } finally { un(); }
}
export const setEnginePath = (path) => invoke("set_opener", { kind: "engine", path });
