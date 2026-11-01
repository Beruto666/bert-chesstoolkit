// Tabuleiro interativo reutilizável: arrastar/clicar peças, destaques e setas/círculos (botão direito).
import { FILES } from "./util.js";
import { pieceHtml, prefs } from "./look.js";
import { SHAPE_COLORS } from "./gametree.js";
import { moveSound } from "./sound.js";

const TYPE = { k: "k", q: "q", r: "r", b: "b", n: "n", p: "p" };

export function parseFen(fen) {
  const map = {};
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      const color = ch === ch.toUpperCase() ? "w" : "b";
      map[FILES[f] + (8 - r)] = { color, type: TYPE[ch.toLowerCase()] };
      f++;
    }
  });
  return map;
}


// Animação de lances (deslizar a peça), como no Lichess. Compara as posições antes/depois e anima só quando
// a diferença é um lance (até 2 peças movidas: roque incluso); saltos longos na lista de lances não animam.
export function diffMoves(prev, next) {
  const same = (a, b) => a && b && a.color === b.color && a.type === b.type;
  const gone = [], came = [];
  for (const sq of Object.keys(prev)) if (!same(prev[sq], next[sq])) gone.push(sq);
  for (const sq of Object.keys(next)) if (!same(prev[sq], next[sq])) came.push(sq);
  const out = [];
  const free = new Set(gone);
  for (const to of came) {
    let best = null, bd = 99;
    for (const from of free) {
      if (!same(prev[from], next[to])) continue;
      const d = Math.max(Math.abs(from.charCodeAt(0) - to.charCodeAt(0)), Math.abs(from[1] - to[1]));
      if (d < bd) { bd = d; best = from; }
    }
    if (best) { free.delete(best); out.push({ from: best, to }); }
  }
  return out.length && out.length <= 2 ? out : [];
}
export function animateMoves(grid, moves, orient, ms = 170, elapsed = 0) {
  if (!moves.length || !prefs.anim) return null;
  const r = grid.getBoundingClientRect(), sz = r.width / 8;
  if (!sz) return null;
  const xy = (sq) => { const f = sq.charCodeAt(0) - 97, rk = Number(sq[1]) - 1; return orient === "w" ? [f, 7 - rk] : [7 - f, rk]; };
  const t0 = performance.now() - elapsed;
  for (const m of moves) {
    const real = grid.querySelector(`.sq[data-sq="${m.to}"] .piece`);
    if (!real) continue;
    const [fx, fy] = xy(m.from), [tx, ty] = xy(m.to);
    // A peça que desliza é uma cópia solta sobre o tabuleiro (a original some até o fim). O movimento é
    // feito quadro a quadro com left/top (sem camadas aceleradas), que o WebKitGTK repinta sem deixar rastro.
    const c = real.cloneNode(true);
    c.classList.remove("ghost");
    c.classList.add("animp");
    c.style.cssText = `width:${sz}px;height:${sz}px;font-size:${sz * 0.84}px;left:${fx * sz}px;top:${fy * sz}px`;
    grid.appendChild(c);
    real.style.visibility = "hidden";
    const tick = (now) => {
      if (!c.isConnected) return; // o tabuleiro foi redesenhado: a animação retomada cuida do resto
      const t = Math.min(1, Math.max(0, (now - t0) / ms)), e = 1 - Math.pow(1 - t, 3);
      c.style.left = (fx + (tx - fx) * e) * sz + "px";
      c.style.top = (fy + (ty - fy) * e) * sz + "px";
      if (t < 1) requestAnimationFrame(tick);
      else { c.remove(); real.style.visibility = ""; }
    };
    tick(performance.now());
    requestAnimationFrame(tick);
  }
  return { moves, orient, ms, t0 };
}

export class Board {
  // o = { onMove(from,to), targets(sq) -> [{to, capture}], canMove(sq) -> bool, onShape(shape), color: () => "G" }
  constructor(root, o) {
    this.o = o;
    this.root = root;
    root.classList.add("bwrap");
    root.innerHTML = `<div class="bgrid"></div><svg class="shapes" viewBox="0 0 8 8" preserveAspectRatio="none"></svg><div class="promo" hidden></div><div class="rz" title="Arraste para redimensionar (duplo clique: automático)"></div>`;
    this.grid = root.querySelector(".bgrid");
    this.svg = root.querySelector(".shapes");
    this.promoEl = root.querySelector(".promo");
    this.st = { fen: "", orient: "w", last: null, check: null, shapes: [], badge: null };
    this.selected = null; this.dragFrom = null; this.ghost = null; this.draft = null; this.pieces = {};
    this._bind();
  }
  set(patch) {
    const prev = this.pieces, oldFen = this.st.fen;
    Object.assign(this.st, patch);
    let anim = [];
    if (patch.fen !== undefined) {
      this.pieces = parseFen(patch.fen);
      if (!patch.reset && oldFen && patch.fen !== oldFen) {
        const mv = diffMoves(prev, this.pieces);
        if (mv.length) moveSound(prev, this.pieces, mv, this.st.check);
        if (!this.noAnim) anim = mv;
      }
    }
    this.noAnim = false;
    if (patch.fen !== undefined || patch.reset) this.selected = null;
    if (patch.fen !== undefined && patch.fen !== oldFen) this._anim = null; // posição nova: descarta a animação anterior
    this.render();
    if (anim.length) this._anim = animateMoves(this.grid, anim, this.st.orient);
  }
  get orient() { return this.st.orient; }
  flip() { this.st.orient = this.st.orient === "w" ? "b" : "w"; this.render(); }

  render() { this._renderGrid(); this._renderShapes(); }

  _renderGrid() {
    const { orient, last, check } = this.st;
    const targets = this.selected && this.o.targets ? this.o.targets(this.selected) : [];
    let html = "";
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const file = orient === "w" ? c : 7 - c;
        const rank = orient === "w" ? 7 - r : r;
        const sq = FILES[file] + (rank + 1);
        const pc = this.pieces[sq];
        const cls = ["sq", (file + rank) % 2 === 0 ? "dark" : "light"];
        if (last && (last.from === sq || last.to === sq)) cls.push("last");
        if (this.selected === sq) cls.push("sel");
        if (check === sq) cls.push("chk");
        const t = targets.find((m) => m.to === sq);
        if (t) cls.push(pc || t.capture ? "cap" : "dot");
        html += `<div class="${cls.join(" ")}" data-sq="${sq}">`;
        if (c === 0) html += `<span class="co r">${rank + 1}</span>`;
        if (r === 7) html += `<span class="co f">${FILES[file]}</span>`;
        if (pc) html += pieceHtml(pc.color, pc.type, this.dragFrom === sq ? "ghost" : "");
        html += `</div>`;
      }
    }
    this.grid.innerHTML = html;
    const A = this._anim;
    if (A && A.orient === orient) {
      const el = performance.now() - A.t0;
      if (el < A.ms) animateMoves(this.grid, A.moves, A.orient, A.ms, el); else this._anim = null;
    }
  }

  // ---- setas e círculos ----
  _xy(sq) {
    const f = FILES.indexOf(sq[0]), r = Number(sq[1]) - 1;
    return this.st.orient === "w" ? [f + 0.5, 7 - r + 0.5] : [7 - f + 0.5, r + 0.5];
  }
  _shapeSvg(s, draft) {
    const col = SHAPE_COLORS[s.c] || SHAPE_COLORS.G;
    const op = draft ? 0.55 : 0.82;
    const [x1, y1] = this._xy(s.f);
    if (s.t === "c" || s.f === s.to) {
      return `<circle cx="${x1}" cy="${y1}" r="0.44" fill="none" stroke="${col}" stroke-width="0.09" opacity="${op}"/>`;
    }
    const [x2, y2] = this._xy(s.to);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const head = 0.34, hw = 0.2;
    const sx = x1 + ux * 0.18, sy = y1 + uy * 0.18;            // começa um pouco depois do centro
    const bx = x2 - ux * head, by = y2 - uy * head;            // base da ponta
    return `<g opacity="${op}"><line x1="${sx}" y1="${sy}" x2="${bx}" y2="${by}" stroke="${col}" stroke-width="0.15" stroke-linecap="round"/>` +
      `<polygon points="${x2},${y2} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}" fill="${col}"/></g>`;
  }
  // selo da anotação do lance (! ? !! ...) no canto da casa de destino, como no Lichess
  _badgeSvg() {
    const b = this.st.badge;
    if (!b) return "";
    const [x, y] = this._xy(b.sq);
    // centro quase no canto superior direito da casa, como no Lichess
    const cx = x + 0.39, cy = y - 0.43, n = b.text.length;
    const fs = n === 1 ? 0.3 : n === 2 ? 0.24 : 0.19;
    // linha de base explícita (centraliza o glifo igual em qualquer webview); símbolos de avaliação ficam mais baixos na fonte, então sobem um pouco
    const K = b.eval ? 0.29 : 0.367;
    return `<defs><filter id="nagsh" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0.035" stdDeviation="0.04" flood-color="#000" flood-opacity="0.5"/></filter></defs>` +
      `<g class="nagb"><circle cx="${cx}" cy="${cy}" r="0.205" fill="${b.color}" filter="url(#nagsh)"/>` +
      `<text x="${cx - 0.005}" y="${cy + fs * K}" font-size="${fs}">${b.text}</text></g>`;
  }
  _renderShapes() {
    let h = "";
    for (const s of this.st.shapes) h += this._shapeSvg(s, false);
    if (this.draft) h += this._shapeSvg(this.draft, true);
    h += this._badgeSvg();
    this.svg.innerHTML = h;
  }

  // ---- promoção ----
  askPromotion(color) {
    return new Promise((res) => {
      const el = this.promoEl;
      el.innerHTML = `<div class="box">${["q", "r", "b", "n"].map((p) => `<button data-p="${p}">${pieceHtml(color, p)}</button>`).join("")}</div>`;
      el.hidden = false;
      const done = (v) => { el.hidden = true; el.onclick = null; res(v); };
      el.onclick = (e) => { const b = e.target.closest("button"); done(b ? b.dataset.p : ""); };
    });
  }

  // ---- interação ----
  _sqAt(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest(".sq");
    if (el && this.grid.contains(el)) return el.dataset.sq;
    // fora do tabuleiro (ex.: durante arraste): calcula pela posição
    const r = this.grid.getBoundingClientRect();
    const c = Math.floor(((e.clientX - r.left) / r.width) * 8), rw = Math.floor(((e.clientY - r.top) / r.height) * 8);
    if (c < 0 || c > 7 || rw < 0 || rw > 7) return null;
    const file = this.st.orient === "w" ? c : 7 - c, rank = this.st.orient === "w" ? 7 - rw : rw;
    return FILES[file] + (rank + 1);
  }
  _colorFor(e) {
    if (e.shiftKey) return "R";
    if (e.ctrlKey || e.metaKey) return "B";
    if (e.altKey) return "Y";
    return (this.o.color && this.o.color()) || "G";
  }
  _bind() {
    const g = this.grid;
    g.addEventListener("contextmenu", (e) => e.preventDefault());
    g.addEventListener("pointerdown", (e) => {
      if (e.button === 2) { // botão direito: desenhar
        e.preventDefault();
        const sq = this._sqAt(e);
        if (!sq) return;
        this.draw = { from: sq, c: this._colorFor(e) };
        this.draft = null;
        g.setPointerCapture?.(e.pointerId);
        return;
      }
      if (e.button !== 0 || this.promoEl.hidden === false) return;
      const sq = this._sqAt(e);
      if (!sq) return;
      if (this.selected && this.selected !== sq && this._legal(this.selected, sq)) { this._try(this.selected, sq); return; }
      const pc = this.pieces[sq];
      if (pc && (!this.o.canMove || this.o.canMove(sq))) {
        this.selected = sq;
        this.pend = { sq, pc, x: e.clientX, y: e.clientY }; // o "arrastar" só começa quando o mouse realmente se move
      } else this.selected = null;
      this._renderGrid();
    });
    window.addEventListener("pointermove", (e) => {
      if (this.pend && !this.ghost && Math.hypot(e.clientX - this.pend.x, e.clientY - this.pend.y) > 4) {
        const { sq, pc } = this.pend;
        this.dragFrom = sq;
        const tmp = document.createElement("div");
        tmp.innerHTML = pieceHtml(pc.color, pc.type, "floating");
        this.ghost = tmp.firstElementChild;
        document.body.appendChild(this.ghost);
        this._renderGrid();
      }
      if (this.ghost) { this.ghost.style.left = e.clientX + "px"; this.ghost.style.top = e.clientY + "px"; }
      if (this.draw) {
        const sq = this._sqAt(e);
        const c = this._colorFor(e);
        this.draft = sq ? { t: sq === this.draw.from ? "c" : "a", f: this.draw.from, to: sq, c } : null;
        this._renderShapes();
      }
    });
    const up = (e, cancel) => {
      if (this.draw) {
        const d = this.draw; this.draw = null; this.draft = null;
        const sq = cancel ? null : this._sqAt(e);
        if (sq && this.o.onShape) {
          this.o.onShape(sq === d.from ? { t: "c", f: d.from, c: this._colorFor(e) } : { t: "a", f: d.from, to: sq, c: this._colorFor(e) });
        } else this._renderShapes();
        return;
      }
      this.pend = null;
      if (!this.ghost) return;
      this.ghost.remove(); this.ghost = null;
      const from = this.dragFrom; this.dragFrom = null;
      const to = cancel ? null : this._sqAt(e);
      if (to && to !== from && this._legal(from, to)) { this.noAnim = true; this._try(from, to); }
      else this._renderGrid();
    };
    window.addEventListener("pointerup", (e) => up(e, false));
    window.addEventListener("pointercancel", (e) => up(e, true));
  }
  _legal(from, to) { return !this.o.targets || this.o.targets(from).some((m) => m.to === to); }
  async _try(from, to) {
    this.selected = null;
    await this.o.onMove(from, to);
  }
}
