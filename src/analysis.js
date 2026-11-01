// Tela de análise: tabuleiro, lista de lances com variações, anotações, partidas do arquivo, salvar.
import { Chess } from "./vendor/chess.js";
import { $, ic, esc, ls, toast, copyText, askChoice, askForm, pgnPicker, pickSave } from "./util.js";
import { Board, parseFen } from "./board.js";
import {
  Game, parseGame, toPgn, newGame, splitGamesRaw, gameSummary, toggleNag, toggleShape,
  NAG_TEXT, MOVE_NAGS, EVAL_NAGS, START_FEN,
} from "./gametree.js";
import { onLook } from "./look.js";
import * as eng from "./engineui.js";
import { openEditor } from "./editor.js";
import * as ex from "./explorer.js";
import * as play from "./play.js";
import * as opn from "./openings.js";

const T = window.__TAURI__;
const invoke = (...a) => T.core.invoke(...a);

// ---------- estado ----------
let game = newGame();
let cur = game.root;
let chess = new Chess(cur.fen);
let fileId = null, fileTitle = "", fileGames = null, gameIdx = 0; // arquivo da biblioteca (ou partidas abertas do disco)
let dirty = false, undoStack = [], redoStack = [];
let repTarget = null; // { id } quando a Análise está editando um repertório (Salvar grava nele)
let shapeColor = "G", tab = "moves";
let nodeById = new Map();

const board = new Board($("abBoard"), {
  canMove: (sq) => { const p = board.pieces[sq]; return !!p && p.color === chess.turn() && play.allows(chess.turn()); },
  targets: (sq) => chess.moves({ square: sq, verbose: true }).map((m) => ({ to: m.to, capture: m.captured !== undefined })),
  onMove: (from, to) => onBoardMove(from, to),
  onShape: (s) => { mutate(() => toggleShape(cur, s)); board.set({ shapes: cur.shapes }); syncNote(); },
  color: () => shapeColor,
});
onLook(() => board.render());

// ---------- desfazer / refazer ----------
const snap = () => ({ pgn: toPgn(game), path: game.path(cur) });
function mutate(fn) {
  const s = snap();
  const r = fn();
  undoStack.push(s);
  if (undoStack.length > 300) undoStack.shift();
  redoStack = [];
  markDirty();
  return r;
}
function restore(s) { game = parseGame(s.pgn); cur = game.nodeAt(s.path); }
function doUndo() {
  if (!undoStack.length) return;
  redoStack.push(snap()); restore(undoStack.pop()); markDirty(); refreshAll();
}
function doRedo() {
  if (!redoStack.length) return;
  undoStack.push(snap()); restore(redoStack.pop()); markDirty(); refreshAll();
}

// ---------- abas (várias partidas abertas) e rascunho ----------
// As variáveis acima (game, cur, fileId…) sempre pertencem à aba ativa; as outras ficam guardadas em `tabs`.
let tabs = [], activeTab = 0, persistTimer = null;
const grab = () => ({ game, cur, fileId, fileTitle, fileGames, gameIdx, dirty, undoStack, redoStack, repTarget, orient: board.orient });
function blankTab() { const g = newGame(); return { game: g, cur: g.root, fileId: null, fileTitle: "", fileGames: null, gameIdx: 0, dirty: false, undoStack: [], redoStack: [], repTarget: null, orient: "w" }; }
function put(s) {
  game = s.game; cur = s.cur || s.game.root; fileId = s.fileId; fileTitle = s.fileTitle; fileGames = s.fileGames; gameIdx = s.gameIdx;
  dirty = s.dirty; undoStack = s.undoStack; redoStack = s.redoStack; repTarget = s.repTarget;
  board.set({ orient: s.orient || "w" });
}
const liveTabs = () => tabs.map((t, i) => (i === activeTab ? grab() : t));
// grava todas as abas (some só o que não dá para recriar: repertório em edição e a lista de partidas do arquivo)
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      ls.set("anaTabs", JSON.stringify({ active: activeTab, tabs: liveTabs().map((t) => ({ pgn: toPgn(t.game), path: t.game.path(t.cur), fileId: t.fileId, fileTitle: t.fileTitle, gameIdx: t.gameIdx, dirty: t.dirty, orient: t.orient })) }));
      localStorage.removeItem("anaDraft");
    } catch {}
  }, 400);
}
function markDirty() {
  dirty = true;
  renderTitle();
  persist();
}
const clearDraft = () => persist();
(function restoreTabs() {
  try {
    const d = JSON.parse(ls.get("anaTabs") || "null");
    let list = d && d.tabs;
    if (!list) { const o = JSON.parse(ls.get("anaDraft") || "null"); if (o) list = [{ ...o, dirty: true }]; }
    if (list && list.length) {
      tabs = list.map((t) => { const g = parseGame(t.pgn); return { ...blankTab(), game: g, cur: g.nodeAt(t.path || []), fileId: t.fileId || null, fileTitle: t.fileTitle || "", gameIdx: t.gameIdx || 0, dirty: !!t.dirty, orient: t.orient || "w" }; });
      activeTab = Math.min((d && d.active) || 0, tabs.length - 1);
      put(tabs[activeTab]);
      return;
    }
  } catch {}
  tabs = [grab()];
})();
const isBlank = () => !game.root.children.length && !dirty && !fileId && !fileGames && !repTarget;
// prepara uma aba para abrir algo novo (reaproveita a atual se ela estiver vazia); true = pode carregar
async function openInNewTab() {
  if (play.active()) { toast("Encerre a partida contra o motor antes de abrir outra."); return false; }
  if (isBlank()) return true;
  tabs[activeTab] = grab();
  tabs.push(blankTab());
  activeTab = tabs.length - 1;
  put(tabs[activeTab]);
  return true;
}
// Treino de finais: abre a posição numa aba nova e começa a jogar contra o motor com um objetivo.
export async function startEndgame(fen, title, color, goal) {
  if (!(await openInNewTab())) return false;
  repTarget = null; fileId = null; fileTitle = title; fileGames = null; gameIdx = 0;
  game = new Game([["Event", title]], fen); cur = game.root; undoStack = []; redoStack = []; dirty = false;
  refreshAll(); setTab("moves"); persist();
  play.startPreset({ col: color }, goal);
  return true;
}
async function newTab() {
  if (!(await openInNewTab())) return false;
  refreshAll(); setTab("moves"); persist();
  return true;
}
function switchTab(i) {
  if (i === activeTab || !tabs[i]) return;
  if (play.active()) { toast("Encerre a partida contra o motor antes de trocar de aba."); return; }
  tabs[activeTab] = grab();
  activeTab = i;
  put(tabs[i]);
  refreshAll(); setTab("moves"); persist();
}
async function closeTab(i) {
  if (play.active()) { toast("Encerre a partida contra o motor antes."); return; }
  if (i !== activeTab) { tabs[activeTab] = grab(); activeTab = i; put(tabs[i]); refreshAll(); }
  if (!(await guardReplace())) return;
  tabs.splice(activeTab, 1);
  if (!tabs.length) tabs.push(blankTab());
  activeTab = Math.min(activeTab, tabs.length - 1);
  put(tabs[activeTab]);
  refreshAll(); setTab("moves"); persist();
}
function tabTitle(t) {
  if (t.fileTitle) return t.fileTitle;
  const w = t.game.header("White"), b = t.game.header("Black");
  if (w && b && w !== "?" && b !== "?") return `${w} – ${b}`;
  return t.game.root.children.length ? "Partida" : "Nova";
}
function renderTabsBar() {
  $("abTabsBar").innerHTML = liveTabs().map((t, i) =>
    `<div class="atab${i === activeTab ? " on" : ""}" data-i="${i}" title="${esc(tabTitle(t))}"><span>${esc(tabTitle(t))}${t.dirty ? " ●" : ""}</span><b class="x" data-x="${i}" aria-label="Fechar aba">×</b></div>`).join("") +
    `<button class="ghost tb" id="abNewTab" title="Nova aba" aria-label="Nova aba">+</button>`;
}
$("abTabsBar").addEventListener("click", (e) => {
  const x = e.target.closest("[data-x]");
  if (x) { closeTab(Number(x.dataset.x)); return; }
  if (e.target.closest("#abNewTab")) { newTab(); return; }
  const t = e.target.closest(".atab");
  if (t) switchTab(Number(t.dataset.i));
});
$("abTabsBar").addEventListener("auxclick", (e) => { const t = e.target.closest(".atab"); if (t && e.button === 1) { e.preventDefault(); closeTab(Number(t.dataset.i)); } });

// ---------- navegação ----------
function kingSquare(fen, color) {
  for (const [sq, p] of Object.entries(parseFen(fen))) if (p.type === "k" && p.color === color) return sq;
  return null;
}
function setCur(node) {
  cur = node;
  chess = new Chess(node.fen);
  board.set({
    fen: node.fen,
    last: node.parent ? { from: node.from, to: node.to } : null,
    check: chess.isCheck() ? kingSquare(node.fen, chess.turn()) : null,
    shapes: node.shapes,
    badge: badgeFor(node),
  });
  renderMoves();
  renderOpening();
  syncNote();
  renderPlayers();
  eng.onPosition();
  if (tab === "info") { const f = $("abFen"); if (f) f.value = cur.fen; }
  if (tab === "db") ex.update();
}
// nome da abertura da posição atual (ou da última posição reconhecida antes dela)
function renderOpening() {
  const o = opn.openingFor(cur), el = $("abOpening");
  el.innerHTML = o ? `<b>${esc(o.eco)}</b> ${esc(o.name)}` : "";
  el.classList.toggle("dim", !!o && !o.exact);
  el.title = o && !o.exact ? "Última posição reconhecida desta partida" : "";
}
opn.init(renderOpening);
// selo (!, ?, !!, ??, !?, ?!) na casa de destino do lance atual
// cores dos selos, iguais às do Lichess; símbolos de avaliação (=, ±, +− ...) em azul claro
const QUAL = { 1: "#22ac38", 3: "#168226", 5: "#ea45d8", 6: "#56b4e9", 2: "#e69d00", 4: "#df5353" };
const EVAL_COLOR = "#56b4e9";
function badgeFor(node) {
  if (!node.parent) return null;
  const q = node.nags.find((g) => QUAL[g]);
  if (q) return { sq: node.to, text: NAG_TEXT[q], color: QUAL[q] };
  const e = node.nags.find((g) => EVAL_NAGS.includes(g));
  if (e) return { sq: node.to, text: NAG_TEXT[e], color: EVAL_COLOR, eval: true };
  const m = eng.moveClass(node); // sem anotação sua: mostra a classificação da engine (imprecisão / erro / erro grave)
  return m ? { sq: node.to, text: ENG_BADGE[m.k][0], color: ENG_BADGE[m.k][1] } : null;
}
const ENG_BADGE = { inac: ["?!", "#56b4e9"], mist: ["?", "#e69d00"], blun: ["??", "#df5353"] };
// atualiza o selo só se mudou (a engine atualiza a lista de lances várias vezes)
function refreshBadge() {
  const b = badgeFor(cur), o = board.st.badge;
  if ((b?.text || "") !== (o?.text || "") || (b?.sq || "") !== (o?.sq || "")) board.set({ badge: b });
}
const go = (n) => n && setCur(n);
const goPrev = () => cur.parent && setCur(cur.parent);
const goNext = () => cur.main && setCur(cur.main);
const goFirst = () => setCur(game.root);
const goLast = () => { let n = cur; while (n.main) n = n.main; setCur(n); };

async function onBoardMove(from, to) {
  const mv = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!mv.length) { board.render(); return; }
  let promo = "";
  if (mv[0].promotion) {
    promo = await board.askPromotion(chess.turn());
    if (!promo) { board.set({ reset: true }); return; }
  }
  const m = mv.find((x) => (x.promotion || "") === promo) || mv[0];
  const existing = cur.children.find((c) => c.san === m.san);
  if (existing) { setCur(existing); play.afterUserMove(); return; }
  const node = mutate(() => game.add(cur, { from, to, promotion: promo || undefined }));
  setCur(node);
  play.afterUserMove();
}

// joga os lances (UCI) de uma linha da engine a partir da posição atual, até o índice k
function playLine(uci, k) {
  const last = mutate(() => {
    let n = cur;
    for (let i = 0; i <= k && i < uci.length; i++) {
      const u = uci[i];
      try { n = game.add(n, { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); } catch { break; }
    }
    return n;
  });
  if (last !== cur) setCur(last);
}
ex.init({
  cur: () => cur, game: () => game,
  playSan: (san) => {
    let m; try { m = new Chess(cur.fen).move(san); } catch { return; }
    const node = mutate(() => game.add(cur, { from: m.from, to: m.to, promotion: m.promotion }));
    if (node) setCur(node);
  },
  openText: (text, title, ply) => openText(text, title, ply),
});
play.init({
  cur: () => cur, go: (n) => go(n), pause: eng.pause, newGame: () => newTab(),
  header: (k) => game.header(k),
  setHeaders: (o) => { mutate(() => { for (const [k, v] of Object.entries(o)) game.setHeader(k, v); }); renderInfo(); renderPlayers(); renderTitle(); },
  flip: (color) => { if (board.orient !== color) board.flip(); renderPlayers(); eng.onFlip(); },
  refresh: () => { setCur(cur); },
  playUci: (u) => {
    const m = new Chess(cur.fen).move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
    const ex = cur.children.find((c) => c.san === m.san);
    setCur(ex || mutate(() => game.add(cur, { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined })));
  },
});
eng.initEngineUI({ moves: () => { renderMoves(); refreshBadge(); }, cur: () => cur, game: () => game, go: (n) => go(n), playLine, orient: () => board.orient, edit: (fn) => { mutate(fn); refreshAll(); } });

// ---------- lista de lances ----------
const nagText = (nags) => nags.map((n) => NAG_TEXT[n] || `$${n}`).join(" ");
function renderLine(first) {
  let h = "", n = first, needNum = true;
  while (n) {
    nodeById.set(n.id, n);
    if (n.pre) h += `<span class="cm">${esc(n.pre)}</span>`;
    if (n.color === "w") h += `<i class="num">${n.num}.</i>`;
    else if (needNum || n.pre) h += `<i class="num">${n.num}…</i>`;
    const q = n.nags.filter((g) => MOVE_NAGS.includes(g)), ev = n.nags.filter((g) => !MOVE_NAGS.includes(g));
    const mc = q.length ? null : eng.moveClass(n);
    h += `<span class="mv${n === cur ? " cur" : ""}" data-id="${n.id}">${esc(n.san)}${mc ? `<i class="mq ${mc.k}" title="${mc.label} (−${mc.loss}% de chance de vitória)"></i>` : ""}${q.length ? `<b class="ng q${q[0]}">${nagText(q)}</b>` : ""}${ev.length ? `<b class="ng ev">${nagText(ev)}</b>` : ""}</span>`;
    let interrupted = false;
    if (n.comment) { h += `<span class="cm" data-id="${n.id}">${esc(n.comment)}</span>`; interrupted = true; }
    if (n.parent.children[0] === n) {
      for (const v of n.parent.children.slice(1)) { h += `<div class="var">${renderLine(v)}</div>`; interrupted = true; }
    }
    needNum = interrupted;
    n = n.children[0];
  }
  return h;
}
function renderMoves() {
  nodeById = new Map([[game.root.id, game.root]]);
  let h = "";
  const rootCls = cur === game.root ? " cur" : "";
  if (game.root.comment) h += `<div class="rootcm${rootCls}" data-id="${game.root.id}">${esc(game.root.comment)}</div>`;
  if (!game.root.children.length) {
    h += `<div class="hint">Jogue um lance no tabuleiro para começar. Clique com o botão direito e arraste para desenhar setas; clique com o botão direito numa casa para um círculo.</div>`;
  } else {
    h += `<div class="mlist">${renderLine(game.root.children[0])}<span class="res">${esc(game.header("Result") || "*")}</span></div>`;
  }
  $("abMoves").innerHTML = h;
  const c = $("abMoves").querySelector(".mv.cur");
  if (c) {
    const box = $("abMoves"), r = c.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.top < b.top + 6 || r.bottom > b.bottom - 6) box.scrollTop += r.top - b.top - b.height / 2;
  } else if (cur === game.root) $("abMoves").scrollTop = 0;
}
$("abMoves").addEventListener("click", (e) => {
  const el = e.target.closest("[data-id]");
  if (el) go(nodeById.get(Number(el.dataset.id)));
});

// ---------- menu de botão direito nos lances ----------
const ctx = $("mvMenu");
const closeCtx = () => { ctx.hidden = true; };
function pgnUpTo(node) { // "1. e4 e5 2. Nf3" até este lance
  let s = "";
  for (const n of game.line(node).slice(1)) s += (n.color === "w" ? `${n.num}. ` : (s === "" ? `${n.num}... ` : "")) + n.san + " ";
  return s.trim();
}
$("abMoves").addEventListener("contextmenu", (e) => {
  const el = e.target.closest(".mv[data-id]");
  if (!el) return;
  e.preventDefault();
  const node = nodeById.get(Number(el.dataset.id));
  if (!node || !node.parent) return;
  setCur(node);
  const idx = node.parent.children.indexOf(node);
  const isVar = idx > 0;
  const item = (act, label, extra = "") => `<button data-act="${act}" ${extra}>${label}</button>`;
  ctx.innerHTML =
    `<div class="ctxh">${node.color === "w" ? node.num + "." : node.num + "…"} ${esc(node.san)}</div>` +
    item("promote", ic("up") + "Promover variação", isVar ? "" : "disabled") +
    item("main", ic("star") + "Tornar linha principal", isVar ? "" : "disabled") +
    item("delete", ic("trash") + (isVar ? "Excluir variação" : "Excluir daqui em diante")) +
    `<hr>` +
    `<div class="ctxn">${[1, 2, 3, 4, 5, 6].map((n) => `<button data-nag="${n}" class="${node.nags.includes(n) ? "on" : ""}" title="${nagTitle(n)}">${NAG_TEXT[n]}</button>`).join("")}</div>` +
    item("comment", ic("message") + "Comentar este lance") +
    `<hr>` +
    item("copyline", ic("copy") + "Copiar lances até aqui") +
    item("copyfen", ic("copy") + "Copiar FEN desta posição");
  ctx.hidden = false;
  const r = ctx.getBoundingClientRect(), W = window.innerWidth, Hh = window.innerHeight;
  ctx.style.left = Math.max(4, Math.min(e.clientX, W - r.width - 6)) + "px";
  ctx.style.top = Math.max(4, Math.min(e.clientY, Hh - r.height - 6)) + "px";
});
ctx.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  const node = cur;
  if (b.dataset.nag) { $("abNags").querySelector(`[data-n="${b.dataset.nag}"]`)?.click(); closeCtx(); return; }
  closeCtx();
  switch (b.dataset.act) {
    case "promote": $("abPromote").click(); break;
    case "main": $("abMain").click(); break;
    case "delete": $("abDelete").click(); break;
    case "comment": setTab("moves"); $("abComment").focus(); break;
    case "copyline": copyText(pgnUpTo(node)); toast("Lances copiados"); break;
    case "copyfen": copyText(node.fen); toast("FEN copiado"); break;
  }
});
window.addEventListener("pointerdown", (e) => { if (!ctx.hidden && !ctx.contains(e.target)) closeCtx(); }, true);
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCtx(); }, true);
window.addEventListener("blur", closeCtx);
$("abMoves").addEventListener("scroll", closeCtx);

// ---------- anotações (NAGs, comentário, variações) ----------
const NAG_ROWS = [[1, 2, 3, 4, 5, 6], [10, 14, 15, 16, 17, 18, 19, 13]];
$("abNags").innerHTML = NAG_ROWS.map((row) => `<div>${row.map((n) => `<button class="ghost nag" data-n="${n}" title="${nagTitle(n)}">${NAG_TEXT[n]}</button>`).join("")}</div>`).join("");
function nagTitle(n) {
  return { 1: "Bom lance", 2: "Erro", 3: "Lance brilhante", 4: "Erro grave", 5: "Lance interessante", 6: "Lance duvidoso", 10: "Igual", 13: "Posição pouco clara", 14: "Brancas ligeiramente melhor", 15: "Pretas ligeiramente melhor", 16: "Brancas melhor", 17: "Pretas melhor", 18: "Brancas ganhando", 19: "Pretas ganhando" }[n] || "";
}
$("abNags").addEventListener("click", (e) => {
  const b = e.target.closest("[data-n]");
  if (!b || !cur.parent) return;
  mutate(() => toggleNag(cur, Number(b.dataset.n)));
  board.set({ badge: badgeFor(cur) });
  renderMoves(); syncNote();
});
let commentSnap = null, commentChanged = false;
$("abComment").addEventListener("focus", () => { commentSnap = snap(); commentChanged = false; });
$("abComment").addEventListener("input", (e) => {
  cur.comment = e.target.value.replace(/\s*\n\s*/g, " ");
  commentChanged = true;
  markDirty();
  renderMoves();
});
$("abComment").addEventListener("blur", () => {
  if (commentChanged && commentSnap) { undoStack.push(commentSnap); redoStack = []; }
  commentSnap = null; commentChanged = false;
  syncNote();
});
function syncNote() {
  const ta = $("abComment");
  if (document.activeElement !== ta) ta.value = cur.comment || "";
  ta.placeholder = cur.parent ? "Comentário neste lance…" : "Comentário da partida…";
  for (const b of $("abNags").querySelectorAll("[data-n]")) {
    b.classList.toggle("on", cur.nags.includes(Number(b.dataset.n)));
    b.disabled = !cur.parent;
  }
  const idx = cur.parent ? cur.parent.children.indexOf(cur) : 0;
  $("abPromote").disabled = idx <= 0;
  $("abMain").disabled = idx <= 0;
  $("abDelete").disabled = !cur.parent;
  $("abUndo").disabled = !undoStack.length;
  $("abRedo").disabled = !redoStack.length;
  $("abClear").disabled = !cur.shapes.length;
}
$("abPromote").onclick = () => { mutate(() => game.promote(cur)); renderMoves(); syncNote(); };
$("abMain").onclick = () => { mutate(() => game.makeMain(cur)); renderMoves(); syncNote(); };
$("abDelete").onclick = () => {
  if (!cur.parent) return;
  const parent = mutate(() => game.remove(cur));
  setCur(parent);
};
$("abClear").onclick = () => { if (!cur.shapes.length) return; mutate(() => { cur.shapes = []; }); board.set({ shapes: cur.shapes }); syncNote(); renderMoves(); };
$("abUndo").onclick = doUndo;
$("abRedo").onclick = doRedo;

// ---------- barra de ferramentas ----------
$("abFirst").onclick = goFirst; $("abPrev").onclick = goPrev; $("abNext").onclick = goNext; $("abLast").onclick = goLast;
$("abFlip").onclick = () => { board.flip(); renderPlayers(); eng.onFlip(); };
for (const b of document.querySelectorAll("[data-sc]")) {
  b.onclick = () => { shapeColor = b.dataset.sc; syncColors(); };
}
function syncColors() { for (const b of document.querySelectorAll("[data-sc]")) b.classList.toggle("on", b.dataset.sc === shapeColor); }
$("abBoard").addEventListener("wheel", (e) => { e.preventDefault(); if (e.deltaY > 0) goNext(); else if (e.deltaY < 0) goPrev(); }, { passive: false });

window.addEventListener("keydown", (e) => {
  if (!$("view-ana").classList.contains("on")) return;
  const t = e.target;
  if (t.closest?.("input,textarea,select,dialog")) return;
  const k = e.key;
  if (e.ctrlKey || e.metaKey) {
    if (k === "z" || k === "Z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    else if (k === "y") { e.preventDefault(); doRedo(); }
    else if (k === "s") { e.preventDefault(); save(); }
    return;
  }
  if (k === "ArrowLeft") { e.preventDefault(); goPrev(); }
  else if (k === "ArrowRight") { e.preventDefault(); goNext(); }
  else if (k === "ArrowUp" || k === "Home") { e.preventDefault(); goFirst(); }
  else if (k === "ArrowDown" || k === "End") { e.preventDefault(); goLast(); }
  else if (k === "f" || k === "F") { board.flip(); renderPlayers(); eng.onFlip(); }
  else if (k === "Delete" && cur.parent) $("abDelete").click();
});

// ---------- cabeçalho, jogadores ----------
function renderPlayers() {
  const mk = (color) => {
    const name = game.header(color === "w" ? "White" : "Black"), elo = game.header(color === "w" ? "WhiteElo" : "BlackElo");
    const nm = !name || name === "?" ? (color === "w" ? "Brancas" : "Pretas") : name;
    return `<span class="pdot ${color}"></span><b>${esc(nm)}</b>${elo && elo !== "?" ? `<small>${esc(elo)}</small>` : ""}`;
  };
  const top = board.orient === "w" ? "b" : "w";
  $("abTop").innerHTML = mk(top);
  $("abBot").innerHTML = mk(top === "w" ? "b" : "w");
}
function renderTitle() {
  const g = fileGames && fileGames.length > 1 ? ` · partida ${gameIdx + 1}/${fileGames.length}` : "";
  $("abFile").textContent = (fileTitle ? fileTitle + g : "Sem arquivo (não salvo na biblioteca)") + (dirty ? "  ●" : "");
  $("abTrain").innerHTML = `${ic("tree")}${repTarget ? "Treinar repertório" : "Treinar"}`;
  $("abFile").classList.toggle("dirty", dirty);
  $("abSave").innerHTML = `${ic("save")}Salvar${dirty ? " •" : ""}`;
  renderTabsBar();
}
const INFO_FIELDS = [["Event", "Evento"], ["Site", "Local"], ["Date", "Data"], ["Round", "Rodada"], ["White", "Brancas"], ["Black", "Pretas"], ["WhiteElo", "Elo das brancas"], ["BlackElo", "Elo das pretas"]];
function renderInfo() {
  $("abInfo").innerHTML = INFO_FIELDS.map(([k, l]) => `<label>${l}</label><input type="text" data-h="${k}" value="${esc(game.header(k) === "?" ? "" : game.header(k))}">`).join("") +
    `<label>Resultado</label><select data-h="Result">${["*", "1-0", "0-1", "1/2-1/2"].map((r) => `<option ${game.header("Result") === r || (!game.header("Result") && r === "*") ? "selected" : ""}>${r}</option>`).join("")}</select>` +
    `<label>Posição atual (FEN)</label><input type="text" id="abFen" readonly value="${esc(cur.fen)}">`;
}
$("abInfo").addEventListener("change", (e) => {
  const k = e.target.dataset.h;
  if (!k) return;
  mutate(() => game.setHeader(k, e.target.value.trim() || (k === "Result" ? "*" : "?")));
  renderPlayers(); renderMoves(); syncNote();
});
function refreshAll() { eng.onGameChanged(); setCur(cur); renderInfo(); renderTitle(); renderGames(); }

// ---------- abas ----------
function setTab(t) {
  tab = t;
  for (const b of $("abTabs").querySelectorAll("button")) b.classList.toggle("on", b.dataset.t === t);
  for (const p of document.querySelectorAll(".abpane")) p.classList.toggle("on", p.id === `pane-${t}`);
  if (t === "info") renderInfo();
  if (t === "db") ex.loadDbs().then(() => ex.update(true));
  if (t === "games") { ensureFileGames().then(renderGames); }
}
$("abTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setTab(b.dataset.t); });

// ---------- partidas do arquivo ----------
async function ensureFileGames() {
  if (fileGames || !fileId) return;
  try { fileGames = splitGamesRaw(await invoke("read_pgn", { id: fileId })); } catch (e) { toast(String(e)); }
  if (fileGames && !fileGames.length) fileGames = null;
}
const joinGames = () => fileGames.map((g) => g.raw).join("\n\n") + "\n";
function renderGames() {
  const box = $("gList");
  if (tab !== "games") return;
  if (!fileGames || fileGames.length < 2) {
    box.innerHTML = `<div class="hint">${fileGames ? "Este arquivo tem uma partida." : "Abra um PGN da biblioteca ou do disco para ver as partidas aqui."}</div>`;
    $("gCount").textContent = "";
    $("gDel").disabled = !fileGames;
    return;
  }
  const q = $("gSearch").value.trim().toLowerCase();
  let rows = "", shown = 0, total = 0;
  fileGames.forEach((g, i) => {
    const s = g.sum || (g.sum = gameSummary(g.raw));
    const who = s.white && s.black && !(s.white === "?" && s.black === "?") ? `${s.white} – ${s.black}` : s.event || `Partida ${i + 1}`;
    const ok = (v) => v && v !== "?" && v !== "????.??.??" && v !== "*" ? v : "";
    const sub = [ok(s.event) && who !== s.event ? s.event : "", ok(s.date), ok(s.result)].filter(Boolean).join(" · ");
    if (q && !(who + " " + sub).toLowerCase().includes(q)) return;
    total++;
    if (shown >= 400) return;
    shown++;
    rows += `<button class="gl-row${i === gameIdx ? " cur" : ""}" data-i="${i}"><span class="n">${i + 1}</span><span class="t"><b>${esc(who)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span></button>`;
  });
  box.innerHTML = rows || `<div class="hint">Nada encontrado.</div>`;
  $("gCount").textContent = total > shown ? `Mostrando ${shown} de ${total}. Refine a busca.` : `${total} partida${total === 1 ? "" : "s"}`;
  $("gDel").disabled = false;
  const c = box.querySelector(".cur");
  if (c && tab === "games") c.scrollIntoView({ block: "nearest" });
}
$("gSearch").addEventListener("input", renderGames);
$("gList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-i]");
  if (!b || !(await guardReplace())) return;
  loadIdx(Number(b.dataset.i));
  setTab("moves");
});
function loadIdx(i) {
  gameIdx = i;
  game = parseGame(fileGames[i].raw);
  cur = game.root;
  undoStack = []; redoStack = []; dirty = false; clearDraft();
  refreshAll();
}
$("gDel").onclick = async () => {
  if (!fileGames) return;
  const c = await askChoice("Excluir partida", `Excluir a partida ${gameIdx + 1} do arquivo? Isso regrava o arquivo.`, ["Excluir", "Cancelar"]);
  if (c !== 0) return;
  fileGames.splice(gameIdx, 1);
  if (fileId) await invoke("write_pgn", { id: fileId, text: fileGames.length ? joinGames() : "" });
  else if (repTarget && fileGames.length) document.dispatchEvent(new CustomEvent("save-rep", { detail: { id: repTarget.id, pgn: joinGames() } }));
  if (!fileGames.length) { fileGames = null; game = newGame(); cur = game.root; gameIdx = 0; undoStack = []; redoStack = []; dirty = false; clearDraft(); refreshAll(); return; }
  loadIdx(Math.min(gameIdx, fileGames.length - 1));
  toast("Partida excluída");
};

// ---------- sessões: abrir / nova / salvar ----------
// pergunta antes de descartar alterações; true = pode continuar
async function guardReplace() {
  if (!dirty) return true;
  const c = await askChoice("Alterações não salvas", "Salvar a partida atual antes de continuar?", ["Salvar", "Descartar", "Cancelar"]);
  if (c === 0) return save();
  return c === 1;
}
export async function openFile(id, title) {
  const have = liveTabs().findIndex((t) => t.fileId === id);
  if (have >= 0) { if (have !== activeTab) switchTab(have); return !play.active() || have === activeTab; } // já aberto: vai para a aba
  let text;
  try { text = await invoke("read_pgn", { id }); } catch (e) { toast(String(e)); return false; }
  if (!(await openInNewTab())) return false;
  repTarget = null; fileId = id; fileTitle = title || ""; fileGames = splitGamesRaw(text);
  if (!fileGames.length) { fileGames = [{ raw: toPgn(newGame()).trim() }]; }
  loadIdx(0);
  setTab(fileGames.length > 1 ? "games" : "moves");
  return true;
}
// Abre uma partida a partir de texto PGN (ex.: vinda de uma database), sem arquivo associado.
export async function openText(text, title, ply = 0) {
  const gs = splitGamesRaw(text);
  if (!gs.length) { toast("Não consegui ler essa partida."); return false; }
  if (!(await openInNewTab())) return false;
  repTarget = null; fileId = null; fileTitle = title || ""; fileGames = gs.length > 1 ? gs : null; gameIdx = 0;
  if (fileGames) loadIdx(0); else { game = parseGame(gs[0].raw); cur = game.root; undoStack = []; redoStack = []; dirty = false; clearDraft(); refreshAll(); }
  setTab(fileGames ? "games" : "moves");
  if (ply > 0) { let n = game.root; for (let i = 0; i < ply && n.main; i++) n = n.main; setCur(n); }
  return true;
}
// Abre um repertório para montar/editar jogando no tabuleiro; Salvar grava de volta nele.
export async function openRepertoire(rec) {
  if (!(await openInNewTab())) return false;
  const gs = splitGamesRaw(rec.pgn);
  fileId = null; repTarget = { id: rec.id }; fileTitle = "Repertório: " + rec.name;
  fileGames = gs.length ? gs : [{ raw: toPgn(newGame()).trim() }];
  gameIdx = 0;
  loadIdx(0);
  board.set({ orient: rec.color });
  renderPlayers();
  setTab("moves");
  return true;
}
// Entrar na Análise: continua de onde parou (as abas ficam abertas).
export async function newBoard() { return true; }
export const hasUnsaved = () => liveTabs().some((t) => t.dirty);
export function show() { eng.onShow(); refreshAll(); renderTitle(); syncColors(); play.onShow(); }
export function hide() { play.onHide(); eng.onHide(); }

async function saveRep() {
  fileGames[Math.min(gameIdx, fileGames.length - 1)] = { raw: toPgn(game).trim() };
  document.dispatchEvent(new CustomEvent("save-rep", { detail: { id: repTarget.id, pgn: joinGames() } }));
  dirty = false; clearDraft(); renderTitle(); renderGames();
  toast("Repertório salvo");
  return true;
}
async function save() {
  if (repTarget) return saveRep();
  if (!fileId) return saveAs();
  await ensureFileGames();
  const raw = toPgn(game).trim();
  if (!fileGames) fileGames = [];
  fileGames[Math.min(gameIdx, fileGames.length)] = { raw };
  try { await invoke("write_pgn", { id: fileId, text: joinGames() }); } catch (e) { toast(String(e)); return false; }
  dirty = false; clearDraft(); renderTitle(); renderGames();
  toast(`Salvo em ${fileTitle || "arquivo"}`);
  return true;
}
async function saveAs() {
  const w = game.header("White"), b = game.header("Black");
  const sug = fileTitle || (w && b && w !== "?" && b !== "?" ? `${w} - ${b}` : game.header("Event") && game.header("Event") !== "Análise" ? game.header("Event") : "Minhas partidas");
  const r = await askForm("Salvar na biblioteca", [
    { key: "name", label: "Nome do arquivo PGN", value: sug },
    { key: "cat", label: "Categoria", value: "Minhas partidas", list: "catList" },
  ], "Salvar");
  if (!r || !r.name.trim()) return false;
  const raw = toPgn(game).trim();
  let text;
  if (fileGames) { fileGames[Math.min(gameIdx, fileGames.length)] = { raw }; text = joinGames(); } else text = raw + "\n";
  try {
    const item = await invoke("add_pgn_text", { name: r.name.trim(), text, category: r.cat.trim() });
    fileId = item.id; fileTitle = item.title;
    if (!fileGames) { fileGames = [{ raw }]; gameIdx = 0; }
  } catch (e) { toast(String(e)); return false; }
  dirty = false; clearDraft(); renderTitle(); renderGames();
  toast("Salvo na biblioteca");
  return true;
}
$("abSave").onclick = () => save();

$("abNew").onclick = async () => {
  if (!(fileId || fileGames)) { await newTab(); return; }
  if (!(await guardReplace())) return;
  if (fileId || fileGames) {
    await ensureFileGames();
    if (!fileGames) fileGames = [];
    fileGames.push({ raw: toPgn(newGame()).trim() });
    loadIdx(fileGames.length - 1);
    markDirty(); // a partida nova só entra no arquivo ao salvar
    toast("Nova partida criada neste arquivo (salve para gravar)");
  } else {
    await newTab();
    return;
  }
  setTab("moves");
};

// ---------- PGN: colar, editar, copiar, exportar, FEN ----------
$("abPaste").onclick = async () => {
  const r = await askForm("Colar PGN", [{ key: "t", label: "Cole um ou mais jogos em PGN", area: true, rows: 14, placeholder: "[Event \"...\"]\n\n1. e4 e5 ..." }], "Abrir");
  if (!r) return;
  const games = splitGamesRaw(r.t);
  if (!games.length) { toast("Não encontrei nenhuma partida nesse texto."); return; }
  if (!(await openInNewTab())) return;
  repTarget = null; fileId = null; fileTitle = games.length > 1 ? "PGN colado" : ""; fileGames = games.length > 1 ? games : null; gameIdx = 0;
  if (fileGames) loadIdx(0); else { game = parseGame(games[0].raw); cur = game.root; undoStack = []; redoStack = []; dirty = true; refreshAll(); }
  setTab(fileGames ? "games" : "moves");
};
$("abEditPgn").onclick = async () => {
  const r = await askForm("Editar PGN da partida", [{ key: "t", label: "Texto PGN (a partida inteira, com variações e comentários)", area: true, rows: 18, value: toPgn(game) }], "Aplicar");
  if (!r) return;
  const gs = splitGamesRaw(r.t);
  if (!gs.length) { toast("PGN vazio."); return; }
  const path = game.path(cur);
  mutate(() => { game = parseGame(gs[0].raw); cur = game.nodeAt(path); });
  refreshAll();
};
$("abCopyPgn").onclick = async () => toast((await copyText(toPgn(game))) ? "PGN copiado" : "Não consegui copiar");
$("abTrain").onclick = async () => {
  if (repTarget) { if (dirty) await save(); document.dispatchEvent(new CustomEvent("goto-rep")); return; }
  let text;
  if (fileGames && fileGames.length > 1) {
    const c = await askChoice("Treinar repertório", "Usar o arquivo inteiro (cada partida = um capítulo) ou só esta partida?", ["Arquivo inteiro", "Só esta partida", "Cancelar"]);
    if (c !== 0 && c !== 1) return;
    if (c === 0) { fileGames[Math.min(gameIdx, fileGames.length - 1)] = { raw: toPgn(game).trim() }; text = joinGames(); } else text = toPgn(game);
  } else text = toPgn(game);
  document.dispatchEvent(new CustomEvent("train-rep", { detail: { pgn: text, name: fileTitle || (game.header("Event") && game.header("Event") !== "Análise" ? game.header("Event") : "Meu repertório") } }));
};
$("abCopyFen").onclick = async () => toast((await copyText(cur.fen)) ? "FEN copiado" : "Não consegui copiar");
$("abFenSet").onclick = async () => {
  const fen = await openEditor(cur.fen);
  if (!fen) return;
  mutate(() => { game = new Game(game.headers.map((h) => [...h]), fen); cur = game.root; });
  refreshAll();
};
$("abExport").onclick = async () => {
  try {
    const path = await pickSave({ filename: (fileTitle || "partida") + ".pgn", extensions: ["pgn"], title: "Exportar PGN" });
    if (!path) return;
    await invoke("export_text", { path, text: toPgn(game) });
    toast("PGN exportado");
  } catch (e) { toast(String(e)); }
};
const importPgn = async (files) => {
  const f = files[0];
  if (!f) return;
  const games = splitGamesRaw(f.text);
  if (!games.length) { toast("Nenhuma partida em " + f.name); return; }
  if (!(await openInNewTab())) return;
  repTarget = null; fileId = null; fileTitle = f.name.replace(/\.pgn$/i, ""); fileGames = games; gameIdx = 0;
  loadIdx(0);
  setTab(games.length > 1 ? "games" : "moves");
};
pgnPicker($("abOpenDisk"), $("abFile2"), false, importPgn);
pgnPicker($("abImport"), $("abFile3"), false, importPgn);

// primeira renderização
board.set({ fen: cur.fen });
setCur(cur);
renderInfo(); renderTitle(); renderGames(); syncColors();
