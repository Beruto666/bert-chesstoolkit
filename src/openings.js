// Nome da abertura (ECO + nome) para a posição atual da Análise. Busca por posição, então transposições funcionam.
import { Chess } from "./vendor/chess.js";
import { SEED } from "./openings_seed.js";
import { ls } from "./util.js";

const T = window.__TAURI__;
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const key = (fen) => fen.split(" ").slice(0, 3).join(" ");
const map = new Map(); // chave da posição → { eco, name }
let pending = [], working = false, onReady = null;

function parse(tsv) {
  const rows = tsv.split("\n");
  const head = rows[0].split("\t");
  const ie = Math.max(0, head.indexOf("eco")), inm = head.indexOf("name") < 0 ? 1 : head.indexOf("name"), ip = head.indexOf("pgn") < 0 ? 2 : head.indexOf("pgn");
  const start = head.includes("eco") || head.includes("name") ? 1 : 0;
  const out = [];
  for (let i = start; i < rows.length; i++) {
    const c = rows[i].split("\t");
    if (c.length >= 3 && c[ip]) out.push({ eco: c[ie], name: c[inm], pgn: c[ip] });
  }
  return out;
}
const sans = (pgn) => pgn.replace(/\d+\.(\.\.)?/g, " ").split(/\s+/).filter(Boolean);

// indexa em pedaços, para não travar a tela
function work() {
  if (working) return;
  working = true;
  const step = () => {
    const t0 = performance.now();
    while (pending.length && performance.now() - t0 < 12) {
      const o = pending.pop();
      try {
        const ch = new Chess(START), mv = sans(o.pgn);
        for (const s of mv) ch.move(s);
        map.set(key(ch.fen()), { eco: o.eco, name: o.name });
      } catch {}
    }
    if (pending.length) setTimeout(step, 0);
    else { working = false; onReady?.(); }
  };
  step();
}
function add(tsv) {
  // a fila é lida do fim para o começo; o que entra depois (base do Lichess) fica na frente e é processado por último, sobrescrevendo a lista embutida
  pending = parse(tsv).reverse().concat(pending);
  work();
}

// Nome da abertura da posição `node` (ou da última posição conhecida antes dela): { eco, name, exact } ou null
export function openingFor(node) {
  let n = node, steps = 0;
  while (n && steps < 60) {
    const o = map.get(key(n.fen));
    if (o) return { ...o, exact: n === node };
    n = n.parent; steps++;
  }
  return null;
}
// Nome da abertura de uma linha em SAN (ex.: ["e4","c5","Nf3"]): a mais longa conhecida ao longo da linha, ou null
export function nameForSans(list) {
  try {
    const ch = new Chess(START), keys = [key(START)];
    for (const s of list) { ch.move(s); keys.push(key(ch.fen())); }
    for (let i = keys.length - 1; i > 0; i--) { const o = map.get(keys[i]); if (o) return o; }
  } catch {}
  return null;
}
export const size = () => map.size;

// cb é chamado quando terminar de indexar (para redesenhar o nome)
export async function init(cb) {
  onReady = cb;
  add(SEED.trim().replace(/^/, "eco\tname\tpgn\n"));
  if (!T?.core) return;
  const today = new Date().toISOString().slice(0, 10);
  try {
    let tsv = await T.core.invoke("openings_load", { download: false });
    if (!tsv && ls.get("openTry") !== today) { // tenta baixar no máximo uma vez por dia
      ls.set("openTry", today);
      tsv = await T.core.invoke("openings_load", { download: true });
    }
    if (tsv) add(tsv);
  } catch {}
}
