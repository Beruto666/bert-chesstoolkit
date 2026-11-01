// Modelo de partida em árvore: lances, variações, comentários, NAGs, setas/círculos.
// Lê e escreve PGN completo (inclusive [%cal], [%csl], [%clk], [%eval]).
import { Chess } from "./vendor/chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const TAG = /^\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/;
const ROSTER = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];
const SUFFIX_NAG = { "!": 1, "?": 2, "!!": 3, "??": 4, "!?": 5, "?!": 6 };
export const NAG_TEXT = {
  1: "!", 2: "?", 3: "!!", 4: "??", 5: "!?", 6: "?!", 7: "□", 10: "=", 13: "∞", 14: "+=", 15: "=+",
  16: "±", 17: "∓", 18: "+−", 19: "−+", 22: "⨀", 23: "⨀", 32: "⟳", 33: "⟳", 36: "→", 37: "→", 40: "↑", 41: "↑",
  132: "⇆", 133: "⇆", 140: "∆", 142: "⌓", 145: "RR", 146: "N",
};
export const MOVE_NAGS = [1, 2, 3, 4, 5, 6];            // qualidade do lance (um só)
export const EVAL_NAGS = [10, 13, 14, 15, 16, 17, 18, 19]; // avaliação da posição (um só)
export const SHAPE_COLORS = { G: "#15781b", R: "#c33", B: "#2a62c9", Y: "#e0a000" };

let uid = 0;
export class Node {
  constructor(parent, m, fen) {
    this.id = ++uid;
    this.parent = parent;
    this.children = [];
    this.fen = fen;
    this.comment = "";   // texto livre
    this.pre = "";       // comentário antes do lance (raro)
    this.nags = [];
    this.shapes = [];    // {t:"a"|"c", f, to, c:"G"|"R"|"B"|"Y"}
    this.cmds = [];      // comandos [%...] preservados (clk, eval...)
    if (m) {
      this.san = m.san; this.from = m.from; this.to = m.to; this.promo = m.promotion || "";
      this.color = m.color;
      this.num = parseInt(parent.fen.split(" ")[5], 10) || 1;
      this.ply = parent.ply + 1;
    } else {
      this.san = ""; this.ply = 0; this.color = null; this.num = 0;
    }
  }
  get isRoot() { return !this.parent; }
  get main() { return this.children[0] || null; }
}

export class Game {
  constructor(headers = [], fen = START_FEN) {
    this.headers = headers;       // [[chave, valor]]
    this.fen0 = fen;
    this.root = new Node(null, null, fen);
  }
  header(k) { const h = this.headers.find((x) => x[0] === k); return h ? h[1] : ""; }
  setHeader(k, v) {
    const h = this.headers.find((x) => x[0] === k);
    if (h) h[1] = v; else this.headers.push([k, v]);
  }
  // sequência de nós da raiz até `node`
  line(node) { const out = []; for (let n = node; n; n = n.parent) out.push(n); return out.reverse(); }
  mainLine() { const out = [this.root]; for (let n = this.root.main; n; n = n.main) out.push(n); return out; }
  path(node) {
    const p = [];
    for (let n = node; n.parent; n = n.parent) p.push(n.parent.children.indexOf(n));
    return p.reverse();
  }
  nodeAt(path) {
    let n = this.root;
    for (const i of path) { if (!n.children[i]) break; n = n.children[i]; }
    return n;
  }
  // Joga um lance a partir de `parent`. Se já existir, reaproveita. `mv` = SAN ou {from,to,promotion}.
  add(parent, mv) {
    const ch = new Chess(parent.fen);
    const m = ch.move(mv); // lança erro se ilegal
    const dup = parent.children.find((c) => c.san === m.san);
    if (dup) return dup;
    const n = new Node(parent, m, m.after);
    parent.children.push(n);
    return n;
  }
  remove(node) {
    if (!node.parent) return node;
    const p = node.parent;
    p.children.splice(p.children.indexOf(node), 1);
    return p;
  }
  // sobe a variação uma posição entre as irmãs
  promote(node) {
    const a = node.parent?.children;
    if (!a) return false;
    const i = a.indexOf(node);
    if (i <= 0) return false;
    [a[i - 1], a[i]] = [a[i], a[i - 1]];
    return true;
  }
  makeMain(node) {
    const a = node.parent?.children;
    if (!a) return false;
    const i = a.indexOf(node);
    if (i <= 0) return false;
    a.splice(i, 1); a.unshift(node);
    return true;
  }
  // percorre todos os nós (profundidade)
  *walk(n = this.root) { yield n; for (const c of n.children) yield* this.walk(c); }
}

// ---- edição de anotações ----
export function toggleNag(node, n) {
  const grp = MOVE_NAGS.includes(n) ? MOVE_NAGS : EVAL_NAGS.includes(n) ? EVAL_NAGS : null;
  const had = node.nags.includes(n);
  if (grp) node.nags = node.nags.filter((x) => !grp.includes(x));
  else node.nags = node.nags.filter((x) => x !== n);
  if (!had) node.nags.push(n);
  node.nags.sort((a, b) => a - b);
}
export function toggleShape(node, s) {
  const i = node.shapes.findIndex((x) => x.t === s.t && x.f === s.f && (s.t === "c" || x.to === s.to));
  if (i < 0) node.shapes.push(s);
  else if (node.shapes[i].c === s.c) node.shapes.splice(i, 1);
  else node.shapes[i].c = s.c;
}

// ---- leitura de PGN ----
// Separa um arquivo em partidas sem perder o texto original (para regravar sem mexer nas outras).
export function splitGamesRaw(text) {
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const games = [];
  let curStart = 0, inBody = false, off = 0;
  const push = (a, b) => { const raw = text.slice(a, b).replace(/^\n+/, "").replace(/\s+$/, ""); if (raw) games.push({ raw }); };
  for (const line of text.split("\n")) {
    const lineStart = off; off += line.length + 1;
    const t = line.trim();
    if (t.startsWith("%")) continue;
    if (TAG.test(t)) {
      if (inBody) { push(curStart, lineStart); curStart = lineStart; inBody = false; }
    } else if (t) inBody = true;
  }
  push(curStart, text.length);
  return games;
}

function readHeaders(raw) {
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) { if (out.length) break; else continue; }
    const m = t.match(TAG);
    if (m) out.push([m[1], m[2].replace(/\\(["\\])/g, "$1")]);
    else break;
  }
  return out;
}

const RESULT = /^(1-0|0-1|1\/2-1\/2|\*)$/;
const CMD = /\[%(\w+)\s+([^\]]*)\]/g;

function parseShapes(kind, arg, into) {
  for (const p of arg.split(",")) {
    const t = p.trim();
    const m = kind === "cal" ? t.match(/^([GRBY])([a-h][1-8])([a-h][1-8])$/) : t.match(/^([GRBY])([a-h][1-8])$/);
    if (!m) continue;
    if (kind === "cal") into.push(m[2] === m[3] ? { t: "c", f: m[2], c: m[1] } : { t: "a", f: m[2], to: m[3], c: m[1] });
    else into.push({ t: "c", f: m[2], c: m[1] });
  }
}
function applyComment(node, raw) {
  const cmds = [];
  const text = raw.replace(CMD, (all, k, arg) => {
    if (k === "cal" || k === "csl") parseShapes(k, arg, node.shapes);
    else cmds.push(all);
    return " ";
  }).replace(/\s+/g, " ").trim();
  node.cmds.push(...cmds);
  if (text) node.comment = node.comment ? node.comment + " " + text : text;
}

// Lê o texto dos lances e monta a árvore a partir de `game.root`.
function parseMovetext(game, text) {
  const stack = [];
  let cur = game.root, pre = "", skip = 0, opened = false; // skip: dentro de variação inválida; opened: logo após "("
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "{") {
      let j = text.indexOf("}", i); if (j < 0) j = n;
      const raw = text.slice(i + 1, j); i = j + 1;
      if (skip) continue;
      if (cur === game.root && !cur.children.length && !stack.length) applyComment(game.root, raw);
      else if (opened) pre += (pre ? " " : "") + raw.replace(CMD, " ").replace(/\s+/g, " ").trim();
      else applyComment(cur, raw);
      continue;
    }
    if (c === ";") { const j = text.indexOf("\n", i); i = j < 0 ? n : j + 1; continue; }
    if (c === "%" && (i === 0 || text[i - 1] === "\n")) { const j = text.indexOf("\n", i); i = j < 0 ? n : j + 1; continue; }
    if (c === "(") {
      i++;
      if (skip) { skip++; continue; }
      if (!cur.parent) { skip = 1; continue; } // variação sem lance anterior: ignora
      stack.push(cur); cur = cur.parent; opened = true; continue;
    }
    if (c === ")") {
      i++;
      if (skip) { skip--; continue; }
      if (stack.length) cur = stack.pop();
      opened = false; pre = "";
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    let j = i;
    while (j < n && !/[\s{}();]/.test(text[j])) j++;
    const tok = text.slice(i, j); i = j;
    if (skip) continue;
    if (/^\$\d+$/.test(tok)) { const v = Number(tok.slice(1)); if (cur.parent && !cur.nags.includes(v)) cur.nags.push(v); continue; }
    if (RESULT.test(tok)) continue;
    let san = tok.replace(/^\d+\.+/, "");
    if (!san || san === "." ) continue;
    if (/^\.+$/.test(san)) continue;
    const suf = san.match(/[!?]+$/);
    if (suf) san = san.slice(0, -suf[0].length);
    san = san.replace(/e\.p\.$/, "");
    if (!san) continue;
    try {
      const nn = game.add(cur, san);
      // no leitor, lances repetidos viram o mesmo nó (aceitável); comentários vão para o nó existente
      opened = false;
      if (pre) { nn.pre = pre; pre = ""; }
      if (suf && SUFFIX_NAG[suf[0]] && !nn.nags.includes(SUFFIX_NAG[suf[0]])) nn.nags.push(SUFFIX_NAG[suf[0]]);
      cur = nn;
    } catch {
      if (stack.length) { skip = 1; cur = stack.pop(); } else break; // lance ilegal: descarta o resto da linha
    }
  }
  return game;
}

export function parseGame(raw) {
  raw = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const headers = readHeaders(raw);
  const lines = raw.split("\n");
  let k = 0;
  while (k < lines.length && (!lines[k].trim() || TAG.test(lines[k].trim()))) k++;
  const body = lines.slice(k).join("\n");
  const fenH = headers.find((h) => h[0] === "FEN");
  let fen = START_FEN;
  if (fenH && fenH[1].trim()) {
    try { fen = new Chess(fenH[1].trim()).fen(); } catch { fen = START_FEN; }
  }
  const g = new Game(headers, fen);
  parseMovetext(g, body);
  return g;
}

// ---- escrita de PGN ----
const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
function commentToken(n) {
  const parts = [];
  const cal = n.shapes.filter((s) => s.t === "a").map((s) => s.c + s.f + s.to);
  const csl = n.shapes.filter((s) => s.t === "c").map((s) => s.c + s.f);
  if (csl.length) parts.push(`[%csl ${csl.join(",")}]`);
  if (cal.length) parts.push(`[%cal ${cal.join(",")}]`);
  parts.push(...n.cmds);
  if (n.comment) parts.push(n.comment.replace(/\}/g, ")"));
  return parts.length ? `{ ${parts.join(" ")} }` : "";
}

function movetext(game) {
  const out = [];
  const rc = commentToken(game.root);
  if (rc) out.push(rc);
  const line = (first, needNum) => {
    let nd = first;
    while (nd) {
      if (nd.pre) out.push(`{ ${nd.pre.replace(/\}/g, ")")} }`);
      if (nd.color === "w") out.push(`${nd.num}.`);
      else if (needNum || nd.pre) out.push(`${nd.num}...`);
      out.push(nd.san);
      for (const g of nd.nags) out.push(`$${g}`);
      const ct = commentToken(nd);
      if (ct) out.push(ct);
      let interrupted = !!ct;
      if (nd.parent.children[0] === nd) {
        for (const v of nd.parent.children.slice(1)) {
          out.push("(");
          line(v, true);
          out.push(")");
          interrupted = true;
        }
      }
      needNum = interrupted;
      nd = nd.children[0];
    }
  };
  line(game.root.children[0], true);
  out.push(game.header("Result") || "*");
  // quebra de linha em 80 colunas, sem partir tokens
  const lines = [];
  let cur = "";
  for (const t of out) {
    if (!cur) cur = t;
    else if (cur.length + 1 + t.length <= 80) cur += " " + t;
    else { lines.push(cur); cur = t; }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

export function toPgn(game) {
  const hs = game.headers.filter((h) => h[0] !== "SetUp" && h[0] !== "FEN");
  const have = new Map(hs.map((h) => [h[0], h[1]]));
  const ordered = [];
  for (const k of ROSTER) ordered.push([k, have.has(k) ? have.get(k) : k === "Result" ? "*" : k === "Date" ? "????.??.??" : "?"]);
  for (const h of hs) if (!ROSTER.includes(h[0])) ordered.push(h);
  if (game.fen0 !== START_FEN) { ordered.push(["SetUp", "1"]); ordered.push(["FEN", game.fen0]); }
  const head = ordered.map(([k, v]) => `[${k} "${esc(v)}"]`).join("\n");
  return head + "\n\n" + movetext(game) + "\n";
}

export function newGame(opts = {}) {
  const hs = [["Event", opts.event || "Análise"], ["Site", "?"], ["Date", opts.date || new Date().toISOString().slice(0, 10).replace(/-/g, ".")], ["Round", "?"], ["White", opts.white || "?"], ["Black", opts.black || "?"], ["Result", "*"]];
  return new Game(hs, opts.fen || START_FEN);
}

// Resumo para listas (sem montar a árvore)
export function gameSummary(raw) {
  const h = new Map(readHeaders(raw));
  return {
    white: h.get("White") || "", black: h.get("Black") || "", result: h.get("Result") || "",
    event: h.get("Event") || "", date: h.get("Date") || "", fen: h.get("FEN") || "",
  };
}
