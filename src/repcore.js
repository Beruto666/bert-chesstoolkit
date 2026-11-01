// Treino de repertório (sem interface): lê um PGN com variantes, monta o grafo de posições,
// controla a sessão de treino e a repetição espaçada por posição.
import { Chess } from "./vendor/chess.js";
import { splitGamesRaw, parseGame } from "./gametree.js";

export const INTERVALS = [1, 3, 7, 14, 30, 60]; // dias até a próxima revisão
export const posKey = (fen) => fen.split(" ").slice(0, 4).join(" ");
export const uci = (m) => m.from + m.to + (m.promo || m.promotion || "");
const pad = (n) => String(n).padStart(2, "0");
export const dstr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (n, d = new Date()) => { const x = new Date(d); x.setDate(x.getDate() + n); return dstr(x); };

export class Repertoire {
  constructor(pgn, color = "w") {
    this.color = color; // lado de quem treina: "w" | "b"
    this.games = splitGamesRaw(pgn).map((g) => parseGame(g.raw));
    this.pos = new Map(); // posKey -> { key, fen, turn, moves: [{san,from,to,promo,uci,comment}] }
    this.lines = [];      // { chapter, title, nodes: [Node] } da primeira jogada até a folha
    this.titles = [];
    this.games.forEach((g, gi) => {
      const t = g.header("Event");
      const w = g.header("White"), b = g.header("Black");
      this.titles.push(t && t !== "?" ? t : w && w !== "?" ? `${w}${b && b !== "?" ? " – " + b : ""}` : `Capítulo ${gi + 1}`);
      this._visit(g.root, [], gi);
    });
  }
  _pos(fen) {
    const key = posKey(fen);
    let p = this.pos.get(key);
    if (!p) { p = { key, fen, turn: fen.split(" ")[1], moves: [] }; this.pos.set(key, p); }
    return p;
  }
  _visit(node, path, gi) {
    const p = this._pos(node.fen);
    if (!node.children.length) { if (path.length) this.lines.push({ chapter: gi, title: this.titles[gi], nodes: path }); return; }
    for (const c of node.children) {
      const u = uci(c);
      let m = p.moves.find((x) => x.uci === u);
      if (!m) { m = { san: c.san, from: c.from, to: c.to, promo: c.promo || "", uci: u, comment: "" }; p.moves.push(m); }
      if (!m.comment && c.comment) m.comment = c.comment;
      this._visit(c, [...path, c], gi);
    }
  }
  // posições em que o usuário decide (e que têm lance no repertório)
  get cards() { return [...this.pos.values()].filter((p) => p.turn === this.color && p.moves.length); }
  at(fen) { return this.pos.get(posKey(fen)) || null; }
}

// ---------- repetição espaçada ----------
// srs[key] = { step, due, ok, fail }
export function gradeCard(srs, key, correct, today = dstr()) {
  const had = !!srs[key];
  const s = srs[key] || (srs[key] = { step: 0, due: today, ok: 0, fail: 0 });
  if (correct) {
    s.ok++;
    if (!had || s.due <= today) { s.step = Math.min(s.step + 1, INTERVALS.length); s.due = addDays(INTERVALS[s.step - 1], new Date(today + "T12:00:00")); }
  } else { s.fail++; s.step = 0; s.due = today; }
  return s;
}
export function repStats(rep, srs, today = dstr()) {
  let nw = 0, learned = 0, due = 0;
  for (const c of rep.cards) {
    const s = srs[c.key];
    if (!s) nw++; else { if (s.step >= 1) learned++; if (s.due <= today) due++; }
  }
  return { cards: rep.cards.length, nw, learned, due, lines: rep.lines.length };
}
export function dueCards(rep, srs, today = dstr()) {
  return rep.cards.filter((c) => srs[c.key] && srs[c.key].due <= today).sort((a, b) => srs[a.key].due.localeCompare(srs[b.key].due) || a.key.localeCompare(b.key));
}
// escolhe uma linha a treinar, dando mais peso às que têm posições novas, falhadas ou vencidas
export function pickLine(rep, srs, chapter = -1, today = dstr(), rnd = Math.random) {
  const pool = rep.lines.filter((l) => chapter < 0 || l.chapter === chapter);
  if (!pool.length) return null;
  const w = pool.map((l) => {
    let k = 0;
    for (const n of l.nodes) {
      const p = n.parent && rep.at(n.parent.fen);
      if (!p || p.turn !== rep.color) continue;
      const s = srs[p.key];
      if (!s || s.step < 1 || s.due <= today) k++;
    }
    return 1 + k * 2;
  });
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

// ---------- sessão ----------
// mode: "study" (guiado, sem nota) | "train" (linha inteira, dá nota) | "review" (uma posição, dá nota)
export class RepSession {
  constructor(rep, { mode = "train", line = null, card = null, srs = {}, today = dstr(), rnd = Math.random } = {}) {
    this.rep = rep; this.mode = mode; this.srs = srs; this.today = today; this.rnd = rnd;
    this.line = line;
    this.played = [];       // uci dos lances jogados desde o início
    this.failed = new Set(); // posições erradas nesta sessão
    this.graded = new Set();
    this.mistakes = 0; this.right = 0;
    this.done = false;
    this.last = null;
    if (mode === "review") { this.chess = new Chess(card.fen); this.single = true; }
    else { this.chess = new Chess(line ? line.nodes[0].parent.fen : rep.games[0].root.fen); this.single = false; }
    this.startFen = this.chess.fen();
  }
  get fen() { return this.chess.fen(); }
  get userTurn() { return !this.done && this.chess.turn() === this.rep.color; }
  get pos() { return this.rep.at(this.fen); }
  _consistent() { // a linha escolhida ainda coincide com o que foi jogado?
    if (!this.line) return false;
    return this.played.every((u, i) => this.line.nodes[i] && uci(this.line.nodes[i]) === u);
  }
  // lance principal esperado agora (o da linha, se coerente; senão o primeiro do repertório)
  expected() {
    const p = this.pos;
    if (!p || !p.moves.length) return null;
    if (this._consistent() && this.line.nodes[this.played.length]) {
      const n = this.line.nodes[this.played.length];
      return p.moves.find((m) => m.uci === uci(n)) || p.moves[0];
    }
    return p.moves[0];
  }
  _apply(m) {
    const r = this.chess.move({ from: m.from, to: m.to, promotion: m.promo || undefined });
    this.played.push(m.uci);
    this.last = { from: m.from, to: m.to };
    const p = this.pos;
    if (!p || !p.moves.length) this.done = true;
    return r;
  }
  _grade(key, ok) {
    if (this.mode === "study" || this.single && false) return;
    if (this.graded.has(key)) return;
    if (!ok) { this.graded.add(key); gradeCard(this.srs, key, false, this.today); }
    else if (!this.failed.has(key)) { this.graded.add(key); gradeCard(this.srs, key, true, this.today); }
  }
  needsPromotion(from, to) { return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion); }
  targets(sq) { return this.chess.moves({ square: sq, verbose: true }); }
  tryMove(from, to, promo = "") {
    if (!this.userTurn) return { status: "wait" };
    const p = this.pos, key = p.key;
    const u = from + to + promo;
    const m = p.moves.find((x) => x.uci === u);
    if (!m) {
      this.mistakes++;
      this.failed.add(key);
      this._grade(key, false);
      return { status: "wrong", expected: p.moves.map((x) => x.san) };
    }
    this._grade(key, true);
    if (!this.failed.has(key)) this.right++;
    this._apply(m);
    if (this.single) this.done = true;
    return { status: this.done ? "done" : "right", san: m.san, comment: m.comment };
  }
  // joga o lance certo pelo usuário (depois de "Solução"): conta como erro
  reveal() {
    if (!this.userTurn) return null;
    const p = this.pos, m = this.expected();
    this.failed.add(p.key);
    this.mistakes++;
    this._grade(p.key, false);
    this._apply(m);
    if (this.single) this.done = true;
    return { san: m.san, from: m.from, to: m.to, comment: m.comment };
  }
  get needsOpponent() { return !this.done && !this.userTurn; }
  // um lance do adversário (da linha, ou sorteado entre os do repertório se o usuário saiu da linha)
  opponentStep() {
    if (!this.needsOpponent) return null;
    const p = this.pos;
    let m;
    if (this._consistent() && this.line.nodes[this.played.length]) m = p.moves.find((x) => x.uci === uci(this.line.nodes[this.played.length]));
    if (!m) m = p.moves[Math.floor(this.rnd() * p.moves.length)];
    this._apply(m);
    return { san: m.san, from: m.from, to: m.to, comment: m.comment };
  }
  hint() {
    const m = this.expected();
    return m ? { from: m.from, to: m.to, san: m.san } : null;
  }
}
