// Adivinhe o lance: uma partida de mestres sorteada da sua database; a abertura é mostrada e você adivinha os lances de um lado.
import { Chess } from "./vendor/chess.js";
import { Board } from "./board.js";
import { parseGame, START_FEN } from "./gametree.js";
import { onLook } from "./look.js";
import { $, esc, ls, toast, sleep } from "./util.js";

const invoke = (c, a) => window.__TAURI__.core.invoke(c, a);
let openAna = null, dbs = [], G = null; // G = partida em curso
export const init = (o) => { openAna = o.open; };

const kingSq = (c) => { for (const [sq, p] of Object.entries(board.pieces)) if (p.type === "k" && p.color === c) return sq; return null; };
const board = new Board($("gsBoard"), {
  canMove: (sq) => !!G && G.wait && !G.over && board.pieces[sq]?.color === G.color,
  targets: (sq) => (G ? new Chess(G.fen).moves({ square: sq, verbose: true }).map((m) => ({ to: m.to, capture: !!m.captured })) : []),
  onMove: (from, to) => onMove(from, to),
  color: () => "G",
});
onLook(() => board.render());

const cfg = () => { try { return JSON.parse(ls.get("gsCfg") || "{}"); } catch { return {}; } };
const stats = () => { try { return { games: 0, pts: 0, tot: 0, ...JSON.parse(ls.get("gsStats") || "{}") }; } catch { return { games: 0, pts: 0, tot: 0 }; } };

export async function show() {
  try { dbs = await invoke("db_list"); } catch { dbs = []; }
  const c = cfg();
  $("gsDb").innerHTML = dbs.length ? dbs.map((d) => `<option value="${esc(d.id)}">${esc(d.name)} (${d.games.toLocaleString("pt-BR")})</option>`).join("") : `<option value="">Nenhuma database — importe uma</option>`;
  if (c.db && dbs.some((d) => d.id === c.db)) $("gsDb").value = c.db;
  if (c.elo !== undefined) $("gsElo").value = c.elo;
  if (c.col) $("gsCol").value = c.col;
  if (c.skip !== undefined) $("gsSkip").value = c.skip;
  renderPanel();
  if (!G) board.set({ fen: START_FEN, last: null, check: null, shapes: [], orient: "w", reset: true });
}

// ---------- sorteio ----------
async function pickGame() {
  const id = $("gsDb").value, d = dbs.find((v) => v.id === id), min = Number($("gsElo").value);
  if (!d || !d.games) throw new Error("Escolha uma database com partidas.");
  for (let t = 0; t < 12; t++) {
    const off = Math.floor(Math.random() * Math.max(1, d.games - 200));
    const pg = await invoke("db_page", { id, offset: off, limit: 200, player: "", side: "", result: "", yearFrom: 0, yearTo: 0 });
    const ok = pg.rows.filter((r) => !min || (r.welo && r.belo && (r.welo + r.belo) / 2 >= min));
    while (ok.length) {
      const r = ok.splice(Math.floor(Math.random() * ok.length), 1)[0];
      const text = await invoke("db_game", { id, index: r.i });
      let game;
      try { game = parseGame(text); } catch { continue; }
      const nodes = game.mainLine().slice(1);
      if (game.root.fen === START_FEN && nodes.length >= 24) return { text, game, nodes, row: r, db: d.name };
    }
  }
  throw new Error("Não achei uma partida com esse Elo nessa database. Tente outro filtro.");
}

$("gsNew").onclick = async () => {
  ls.set("gsCfg", JSON.stringify({ db: $("gsDb").value, elo: $("gsElo").value, col: $("gsCol").value, skip: $("gsSkip").value }));
  $("gsNew").disabled = true; $("gsMsg").textContent = "Sorteando uma partida…";
  let g;
  try { g = await pickGame(); } catch (e) { $("gsMsg").textContent = String(e.message || e); $("gsNew").disabled = false; return; }
  $("gsNew").disabled = false;
  const col = $("gsCol").value === "r" ? (Math.random() < 0.5 ? "w" : "b") : $("gsCol").value;
  G = { ...g, color: col, i: 0, fen: START_FEN, wait: false, over: false, pts: 0, tot: 0, firsts: 0, tries: 0, token: (G?.token || 0) + 1, msg: "" };
  board.set({ fen: START_FEN, last: null, check: null, shapes: [], orient: col, reset: true });
  const skip = Number($("gsSkip").value);
  // abertura: mostrada de uma vez (até `skip` lances, e pelo menos até a primeira decisão do usuário)
  while (G.i < Math.min(skip, G.nodes.length - 1)) apply(G.nodes[G.i], true);
  next();
};

function apply(n, quiet) {
  G.fen = n.fen; G.i++;
  const c = new Chess(n.fen);
  board.noAnim = !!quiet;
  board.set({ fen: n.fen, last: { from: n.from, to: n.to }, shapes: [], check: null });
  if (c.isCheck()) board.set({ check: kingSq(c.turn()) });
}
async function next() {
  const my = G.token;
  G.tries = 0;
  while (G.i < G.nodes.length) {
    const n = G.nodes[G.i];
    if (n.color === G.color) { G.wait = true; G.msg = `Sua vez: qual lance as ${G.color === "w" ? "brancas" : "pretas"} jogaram?`; renderPanel(); return; }
    G.wait = false; renderPanel();
    await sleep(650);
    if (!G || G.token !== my) return;
    apply(n);
  }
  finish();
}
function finish() {
  G.over = true; G.wait = false;
  const s = stats(); s.games++; s.pts += G.pts; s.tot += G.tot; ls.set("gsStats", JSON.stringify(s));
  const r = G.row;
  G.msg = `Fim da partida! ${G.row.white} (${r.welo || "?"}) – ${G.row.black} (${r.belo || "?"}), ${r.year || "?"}, ${r.result}. Você fez ${fmt(G.pts)} de ${G.tot} (${G.tot ? Math.round((100 * G.pts) / G.tot) : 0}%).`;
  renderPanel();
}
const fmt = (x) => String(x).replace(".", ",");

async function onMove(from, to) {
  if (!G || !G.wait || G.over) { board.set({ reset: true }); return; }
  const c = new Chess(G.fen);
  const legal = c.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!legal.length) { board.set({ reset: true }); return; }
  let promo = "";
  if (legal[0].promotion) { promo = await board.askPromotion(G.color); if (!promo) { board.set({ reset: true }); return; } }
  const exp = G.nodes[G.i];
  const hit = from === exp.from && to === exp.to && promo === (exp.promo || "");
  if (hit) {
    G.tot++; const p = G.tries === 0 ? 1 : 0.5; G.pts += p; if (G.tries === 0) G.firsts++;
    G.msg = `✔ ${exp.san}${G.tries ? " (na 2ª tentativa)" : ""}`;
    apply(exp); await next();
    return;
  }
  G.tries++;
  board.set({ reset: true });
  if (G.tries < 2) { G.msg = "✘ Não foi esse lance. Tente de novo (vale meio ponto)."; renderPanel(); return; }
  reveal();
}
function reveal() {
  const exp = G.nodes[G.i];
  G.tot++;
  G.msg = `✘ Na partida foi ${exp.san}.`;
  board.set({ shapes: [{ t: "a", f: exp.from, to: exp.to, c: "G" }] });
  G.wait = false; renderPanel();
  const my = G.token;
  sleep(1100).then(() => { if (G && G.token === my) { apply(exp); next(); } });
}
$("gsHint").onclick = () => {
  if (!G || !G.wait) return;
  const exp = G.nodes[G.i];
  board.set({ shapes: [{ t: "c", f: exp.from, c: "Y" }] });
  G.tries = Math.max(G.tries, 1); // com dica, o máximo é meio ponto
};
$("gsShow").onclick = () => { if (G && G.wait) reveal(); };
$("gsOpen").onclick = () => { if (G && openAna) openAna(G.text, G.db); };

function renderPanel() {
  const s = stats();
  $("gsStats").innerHTML = G
    ? `<div class="stat"><small>Pontos</small><b>${fmt(G.pts)} / ${G.tot}</b></div><div class="stat"><small>De 1ª</small><b>${G.firsts}</b></div><div class="stat"><small>Lance</small><b>${Math.ceil(G.i / 2)}</b></div>`
    : `<div class="stat"><small>Partidas</small><b>${s.games}</b></div><div class="stat"><small>Aproveitamento</small><b>${s.tot ? Math.round((100 * s.pts) / s.tot) + "%" : "—"}</b></div>`;
  $("gsMsg").textContent = G ? G.msg : "Escolha a database e clique em “Sortear partida”. Você vê a abertura e adivinha os lances do seu lado.";
  $("gsHint").disabled = !G || !G.wait; $("gsShow").disabled = !G || !G.wait; $("gsOpen").disabled = !G || !G.over;
}
