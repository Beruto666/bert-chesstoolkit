import { Chess } from "./vendor/chess.js";

const TAG = /^\[\s*(\w+)\s+"(.*)"\s*\]$/;

// Separa um arquivo PGN em partidas (cabeçalhos + texto dos lances).
function splitGames(text) {
  const games = [];
  let tags = [], body = [], inBody = false;
  const flush = () => {
    if (tags.length || body.join("").trim()) games.push({ tags, body: body.join("\n") });
    tags = []; body = []; inBody = false;
  };
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const t = line.trim();
    if (t.startsWith("%")) continue;
    if (TAG.test(t)) {
      if (inBody) flush();
      tags.push(t);
      continue;
    }
    body.push(line);
    if (t) inBody = true;
  }
  flush();
  return games;
}

// Lê o texto dos lances: ignora variações ( ), NAGs ($1) e resultado;
// guarda comentários { } da linha principal junto do lance anterior.
export function parseMovetext(text) {
  const moves = [];
  const intro = [];
  let i = 0, depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "{") {
      let j = text.indexOf("}", i);
      if (j < 0) j = text.length;
      const raw = text.slice(i + 1, j);
      i = j + 1;
      if (depth === 0) {
        const clean = raw.replace(/\[%[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
        if (clean) {
          if (moves.length) moves[moves.length - 1].c = (moves[moves.length - 1].c + " " + clean).trim();
          else intro.push(clean);
        }
      }
      continue;
    }
    if (c === ";") {
      const j = text.indexOf("\n", i);
      i = j < 0 ? text.length : j + 1;
      continue;
    }
    if (c === "(") { depth++; i++; continue; }
    if (c === ")") { depth = Math.max(0, depth - 1); i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    let j = i;
    while (j < text.length && !/[\s{}();]/.test(text[j])) j++;
    const tok = text.slice(i, j);
    i = j;
    if (depth > 0) continue;
    if (/^\$\d+$/.test(tok)) continue;
    if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
    const san = tok.replace(/^\d+\.+/, "").replace(/[!?]+$/, "");
    if (!san) continue;
    moves.push({ san, c: "" });
  }
  return { moves, intro: intro.join(" ") };
}

// Cada partida vira um puzzle: FEN = posição inicial, linha principal = solução.
// Lance 1 é do jogador, 2 é a resposta do adversário, 3 é do jogador...
export function parsePuzzles(text) {
  const out = [];
  for (const g of splitGames(text)) {
    const tags = new Map();
    for (const l of g.tags) {
      const m = l.match(TAG);
      if (m) tags.set(m[1], m[2].replace(/\\"/g, '"'));
    }
    let chess;
    try { chess = tags.get("FEN") ? new Chess(tags.get("FEN")) : new Chess(); } catch { continue; }
    const fen = chess.fen();
    const { moves: toks, intro } = parseMovetext(g.body);
    const moves = [];
    for (const t of toks) {
      let m;
      try { m = chess.move(t.san); } catch { break; }
      if (!m) break;
      moves.push({ f: m.from, t: m.to, p: m.promotion || "", san: m.san, c: t.c });
    }
    if (moves.length % 2 === 0) moves.pop(); // termina no lance do jogador
    if (!moves.length) continue;
    const pick = (k) => { const v = tags.get(k); return v && v !== "?" ? v : ""; };
    out.push({ fen, moves, intro, title: pick("Title") || pick("Event") });
  }
  return out;
}
