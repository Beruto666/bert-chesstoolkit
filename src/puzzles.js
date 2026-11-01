// Puzzles: PGN próprio, certo/errado, revisão espaçada e modo relâmpago
import { Chess } from "./vendor/chess.js";
import { PuzzleSession } from "./session.js";
import { parsePuzzles } from "./pgn.js";
import { initLp } from "./lipuz.js";

import { $, ic, esc, sleep, ls, FILES, pgnPicker } from "./util.js";
import { getAll, getOne, putRec, delRec, storeReady } from "./store.js";
import { pieceHtml, onLook, lookReady } from "./look.js";
import { animateMoves, diffMoves } from "./board.js";
import { moveSound, play as sfx } from "./sound.js";
// ---------- estado ----------
let metas = [], meta = null, puzzles = [], pi = 0, S = null;
let selected = null, locked = false, token = 0, hintShape = null, flash = null, showExpl = false;
let fb = null, dragFrom = null, ghostEl = null, random = ls.get("rnd") === "1", armed = { reset: false, del: false };
let mode = "train";
let blitz = null, blitzTimer = null, blitzBest = {};
const INTERVALS = [1, 3, 7, 14, 30]; // dias até a próxima revisão
const today = () => new Date().toLocaleDateString("sv");
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv"); };
const dueList = () => !meta ? [] : Object.entries(meta.srs || {})
  .filter(([i, v]) => v.due <= today() && puzzles[i])
  .sort((a, b) => a[1].due.localeCompare(b[1].due))
  .map(([i]) => Number(i));
export function puzzlesInfo() {
  const t = today();
  return { sets: metas.length, due: metas.reduce((n, m) => n + Object.values(m.srs || {}).filter((v) => v.due <= t).length, 0) };
}
const placeholder = new Chess();

const saveMeta = () => meta && putRec("meta", meta);
function setFb(kind, text) { fb = kind ? { kind, text } : null; }

// ---------- conjuntos ----------
function fillSelect() {
  const sel = $("setSel");
  sel.innerHTML = metas.length
    ? `<option value="">Escolher conjunto…</option>` + metas.map((m) => `<option value="${esc(m.id)}">${esc(m.name)} (${m.count})</option>`).join("")
    : `<option value="">Nenhum conjunto — importe um PGN</option>`;
  sel.value = meta ? meta.id : "";
}
async function selectSet(id) {
  stopBlitz();
  if (mode === "blitz") mode = "train";
  meta = metas.find((m) => m.id === id) || null;
  if (meta) meta.srs = meta.srs || {};
  if (!meta) { puzzles = []; S = null; fb = null; fillSelect(); render(); return; }
  const rec = await getOne("data", id);
  puzzles = rec?.puzzles || [];
  ls.set("last", id);
  fillSelect();
  startPuzzle(Math.min(Math.max(meta.pos || 0, 0), Math.max(puzzles.length - 1, 0)));
}
function startPuzzle(i, track = true) {
  token++;
  if (!puzzles.length) { S = null; render(); return; }
  pi = i;
  if (track) { meta.pos = i; saveMeta(); }
  S = new PuzzleSession(puzzles[i]);
  selected = null; locked = false; hintShape = null; flash = null; showExpl = false;
  if (mode !== "blitz") setFb(S.p.intro ? "info" : null, S.p.intro);
  render();
}

// ---------- jogada ----------
function onFail() {
  meta.results[pi] = "fail";
  meta.streak = 0;
  meta.srs[pi] = { lvl: 0, due: addDays(1) }; // errou: volta amanhã
  saveMeta();
}
function commit(from, to, promo) {
  const wasFailed = S.failed;
  const res = S.tryMove(from, to, promo);
  selected = null; hintShape = null;
  const bz = mode === "blitz" && blitz && !blitz.over;
  if (res.status === "wrong") {
    sfx("bad");
    if (bz) {
      blitz.errors++;
      blitz.end -= 10000;
      flash = to; locked = true;
      setFb("wrong", "Errado: −10 s. Próximo puzzle!");
      render();
      const t = token;
      setTimeout(() => { if (t === token && blitz && !blitz.over) nextBlitz(); }, 600);
      return;
    }
    if (!wasFailed) onFail();
    flash = to;
    setFb("wrong", "Esse não é o lance. Tente outra vez.");
    render();
    const t = token;
    setTimeout(() => { if (t === token) { flash = null; render(); } }, 700);
    return;
  }
  if (res.status === "solved") {
    sfx("ok");
    if (bz) {
      blitz.score++;
      locked = true;
      setFb("solved", "+1 ponto");
      render();
      const t = token;
      setTimeout(() => { if (t === token && blitz && !blitz.over) nextBlitz(); }, 450);
      return;
    }
    if (!S.failed && !S.shown) {
      meta.results[pi] = "ok";
      meta.streak = (meta.streak || 0) + 1;
      const prev = meta.srs[pi];
      if (!prev || prev.due <= today()) { // revisão em dia: sobe o intervalo
        const lvl = prev ? Math.min(prev.lvl + 1, 4) : 1;
        meta.srs[pi] = { lvl, due: addDays(INTERVALS[lvl]) };
      }
      saveMeta();
    }
    setFb("solved", res.note);
    showExpl = true;
    render();
    return;
  }
  // certo, mas o puzzle continua: o adversário responde
  setFb("right", res.note);
  locked = true;
  render();
  const t = token;
  setTimeout(() => {
    if (t !== token) return;
    const r = S.playNext();
    locked = false;
    setFb("right", [res.note, r.c].filter(Boolean).join(" "));
    render();
  }, 450);
}
async function tryUser(from, to) {
  if (S.needsPromotion(from, to)) {
    const p = await askPromo(S.orient);
    if (!p) { selected = null; render(); return; }
    commit(from, to, p);
  } else commit(from, to, "");
}
function askPromo(color) {
  return new Promise((res) => {
    const box = $("promo");
    box.innerHTML = `<div class="box">${["q", "r", "b", "n"].map((p) => `<button data-p="${p}">${pieceHtml(color, p)}</button>`).join("")}</div>`;
    box.hidden = false;
    const done = (v) => { box.hidden = true; box.onclick = null; res(v); };
    box.onclick = (e) => {
      const b = e.target.closest("button");
      done(b ? b.dataset.p : "");
    };
  });
}

// ---------- tabuleiro ----------
let pAnim = null, prevPieces = null, prevS = null, prevOrient = "w", skipAnim = false;
function renderBoard() {
  const b = $("board");
  const game = S ? S.game : placeholder;
  const orient = S ? S.orient : "w";
  const targets = S && selected && S.canMove && !locked ? S.targets(selected) : [];
  let kingSq = null;
  if (S && game.isCheck()) {
    game.board().forEach((row, r) => row.forEach((p, c) => {
      if (p && p.type === "k" && p.color === game.turn()) kingSq = FILES[c] + (8 - r);
    }));
  }
  let html = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const file = orient === "w" ? c : 7 - c;
      const rank = orient === "w" ? 7 - r : r;
      const sq = FILES[file] + (rank + 1);
      const pc = game.get(sq);
      const cls = ["sq", (file + rank) % 2 === 0 ? "dark" : "light"];
      if (S?.lastMove && (S.lastMove.from === sq || S.lastMove.to === sq)) cls.push("last");
      if (selected === sq) cls.push("sel");
      if (kingSq === sq) cls.push("chk");
      if (flash === sq) cls.push("bad");
      if (hintShape?.from === sq) cls.push("hf");
      if (hintShape?.to === sq) cls.push("ht");
      const t = targets.find((m) => m.to === sq);
      if (t) cls.push(pc ? "cap" : "dot");
      html += `<div class="${cls.join(" ")}" data-sq="${sq}">`;
      if (c === 0) html += `<span class="co r">${rank + 1}</span>`;
      if (r === 7) html += `<span class="co f">${FILES[file]}</span>`;
      if (pc) html += pieceHtml(pc.color, pc.type, dragFrom === sq ? "ghost" : "");
      html += `</div>`;
    }
  }
  b.innerHTML = html;
  // animação do lance (não anima depois de arrastar, nem em trocas de problema)
  const now = {};
  game.board().forEach((row, r) => row.forEach((p, c) => { if (p) now[FILES[c] + (8 - r)] = { color: p.color, type: p.type }; }));
  const same = prevPieces && S && prevS === S && prevOrient === orient;
  const step = same ? diffMoves(prevPieces, now) : [];
  if (step.length) moveSound(prevPieces, now, step, game.isCheck());
  const mv = !skipAnim ? step : [];
  if (mv.length) pAnim = animateMoves(b, mv, orient);
  else if (pAnim && same && !skipAnim) { const el = performance.now() - pAnim.t0; if (el < pAnim.ms) animateMoves(b, pAnim.moves, orient, pAnim.ms, el); else pAnim = null; }
  else pAnim = null;
  skipAnim = false; prevPieces = S ? now : null; prevS = S; prevOrient = orient;
}
const board = $("board");
board.addEventListener("pointerdown", (e) => {
  if (!S || locked || !S.canMove) return;
  const el = e.target.closest(".sq");
  if (!el) return;
  const sq = el.dataset.sq;
  if (selected && selected !== sq && S.isLegal(selected, sq)) { tryUser(selected, sq); return; }
  const pc = S.game.get(sq);
  if (pc && pc.color === S.orient) {
    selected = sq;
    pend = { sq, pc, x: e.clientX, y: e.clientY }; // arrastar só começa quando o mouse se move
  } else selected = null;
  renderBoard();
});
let pend = null;
window.addEventListener("pointermove", (e) => {
  if (pend && !ghostEl && Math.hypot(e.clientX - pend.x, e.clientY - pend.y) > 4) {
    dragFrom = pend.sq;
    const tmp = document.createElement("div");
    tmp.innerHTML = pieceHtml(pend.pc.color, pend.pc.type, "floating");
    ghostEl = tmp.firstElementChild;
    document.body.appendChild(ghostEl);
    renderBoard();
  }
  if (ghostEl) { ghostEl.style.left = e.clientX + "px"; ghostEl.style.top = e.clientY + "px"; }
});
function endDrag(e, cancelled) {
  pend = null;
  if (!ghostEl) return;
  ghostEl.remove();
  ghostEl = null;
  const from = dragFrom;
  dragFrom = null;
  const to = cancelled ? null : document.elementFromPoint(e.clientX, e.clientY)?.closest(".sq")?.dataset.sq;
  if (S && to && to !== from && S.isLegal(from, to)) { skipAnim = true; tryUser(from, to); }
  else renderBoard();
}
window.addEventListener("pointerup", (e) => endDrag(e, false));
window.addEventListener("pointercancel", (e) => endDrag(e, true));

// ---------- painel ----------
function counts() {
  const r = meta ? Object.values(meta.results) : [];
  const ok = r.filter((x) => x === "ok").length, fail = r.filter((x) => x === "fail").length;
  return { ok, fail, acc: ok + fail ? Math.round((ok / (ok + fail)) * 100) + "%" : "-" };
}
const fmt = (ms) => { const t = Math.ceil(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
function renderStats() {
  let rows;
  if (blitz) {
    const left = blitz.over ? 0 : Math.max(0, blitz.end - Date.now());
    rows = [["Pontos", blitz.score], ["Erros", blitz.errors], ["Recorde", blitzBest[String(blitz.dur / 60)] || 0], [`${ic("timer")}Tempo`, fmt(left)]];
  } else {
    const c = counts();
    rows = [["Feitos", meta ? `${c.ok + c.fail}/${puzzles.length}` : "-"], ["Precisão", c.acc], ["Acertos", c.ok], [`Sequência ${ic("flame")}`, meta?.streak || 0]];
  }
  $("stats").innerHTML = rows.map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join("");
}
function renderPanel() {
  renderStats();
  $("mTrain").className = mode === "train" ? "on" : "";
  $("mRev").className = mode === "review" ? "on" : "";
  $("mBlitz").className = mode === "blitz" ? "on" : "";
  $("mRev").innerHTML = `${ic("repeat")}Revisão (${dueList().length})`;
  $("bzDur").disabled = !!(blitz && !blitz.over);

  $("info").innerHTML = S
    ? `<b>${esc(S.p.title || "Puzzle " + (pi + 1))}</b><br>Puzzle ${pi + 1} de ${puzzles.length} · jogam as ${S.orient === "w" ? "brancas" : "pretas"}`
    : metas.length ? "Escolha um conjunto de puzzles na lista acima para começar." : "Importe um arquivo PGN para começar. Cada partida com [FEN] vira um puzzle.";

  const titles = { right: "Correto!", solved: "Puzzle resolvido!", wrong: "Errado — tente outra vez", info: "" };
  $("fb").innerHTML = fb && (fb.text || titles[fb.kind])
    ? `<div class="alert ${fb.kind}">${titles[fb.kind] ? `<b>${titles[fb.kind]}</b>` : ""}${esc(fb.text || "")}</div>`
    : "";

  $("expl").innerHTML = S && showExpl
    ? `<h3>Linha completa</h3>` + S.explanation().map((m) => `<div class="mv"><i>${m.label}</i> <b>${esc(m.san)}</b>${m.c ? " — " + esc(m.c) : ""}</div>`).join("") + (S.p.themes ? `<div class="mv" style="margin-top:6px"><i>Temas:</i> ${esc(S.p.themes)}</div>` : "")
    : "";

  $("list").innerHTML = puzzles.map((_, i) => `<button data-i="${i}" class="${meta.results[i] || ""}${i === pi ? " cur" : ""}">${i + 1}</button>`).join("");

  const has = !!S;
  const bzOn = mode === "blitz";
  $("hint").disabled = !has || S.solved || locked || bzOn;
  $("sol").disabled = !has || bzOn;
  $("again").disabled = !has || bzOn;
  $("prev").disabled = !has || pi === 0 || bzOn;
  $("next").disabled = !has || bzOn;
  $("reset").textContent = armed.reset ? "Confirmar zerar?" : "Zerar progresso";
  $("delSet").textContent = armed.del ? "Confirmar excluir?" : "Excluir conjunto";
  $("reset").disabled = $("delSet").disabled = !meta;
  $("rnd").checked = random;
}
function render() { renderBoard(); renderPanel(); }

// ---------- botões ----------
$("hint").onclick = () => {
  const h = S?.hint();
  if (!h) return;
  hintShape = h.step === 1 ? { from: h.from } : h.step === 2 ? { from: h.from, to: h.to } : null;
  render();
};
$("sol").onclick = async () => {
  if (!S) return;
  if (S.solved) { showExpl = true; render(); return; }
  const t = ++token;
  S.shown = true;
  if (!S.failed) { S.failed = true; onFail(); }
  locked = true; hintShape = null; selected = null;
  while (!S.solved) {
    if (t !== token) return;
    S.playNext();
    render();
    await sleep(650);
  }
  locked = false;
  showExpl = true;
  setFb("info", "Solução mostrada. Este puzzle conta como erro.");
  render();
};
$("again").onclick = () => S && startPuzzle(pi);
$("prev").onclick = () => pi > 0 && startPuzzle(pi - 1);
$("next").onclick = () => {
  if (!meta || !puzzles.length || mode === "blitz") return;
  if (mode === "review") {
    const due = dueList().filter((i) => i !== pi);
    if (!due.length) { setFb("info", "Revisões de hoje concluídas!"); render(); return; }
    startPuzzle(due[0]);
    return;
  }
  const n = puzzles.length, res = meta.results;
  const unsolved = [];
  for (let i = 0; i < n; i++) if (!res[i]) unsolved.push(i);
  let nxt = null;
  if (random) {
    const pool = (unsolved.length ? unsolved : [...Array(n).keys()]).filter((i) => i !== pi);
    if (pool.length) nxt = pool[Math.floor(Math.random() * pool.length)];
  } else {
    for (let i = pi + 1; i < n && nxt === null; i++) if (!res[i]) nxt = i;
    for (let i = 0; i < pi && nxt === null; i++) if (!res[i]) nxt = i;
  }
  if (nxt === null || (!unsolved.length && !random)) {
    const c = counts();
    setFb("info", `Conjunto concluído! Acertos: ${c.ok} de ${n} (${c.acc}).`);
    render();
    return;
  }
  startPuzzle(nxt);
};
$("list").onclick = (e) => {
  const b = e.target.closest("button");
  if (b && mode !== "blitz") startPuzzle(Number(b.dataset.i));
};
$("rnd").onchange = (e) => { random = e.target.checked; ls.set("rnd", random ? "1" : "0"); };
$("setSel").onchange = (e) => selectSet(e.target.value);
// cria um conjunto de puzzles já convertidos (usado pelo import de PGN e pelo banco do Lichess)
async function addSet(name, list) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const m = { id, name, count: list.length, results: {}, streak: 0, pos: 0, created: Date.now() };
  await putRec("meta", m);
  await putRec("data", { id, puzzles: list });
  metas.push(m);
  fillSelect();
  await selectSet(id);
  return id;
}
initLp(addSet);
pgnPicker($("imp"), $("file"), true, async (files) => {
  for (const f of files) {
    const list = parsePuzzles(f.text);
    if (!list.length) { setFb("info", `Nenhum puzzle válido em ${f.name}.`); render(); continue; }
    await addSet(f.name.replace(/\.pgn$/i, ""), list);
  }
});
$("reset").onclick = () => {
  if (!meta) return;
  if (!armed.reset) { armed.reset = true; armed.del = false; renderPanel(); return; }
  armed.reset = false;
  meta.results = {}; meta.streak = 0; meta.srs = {};
  saveMeta();
  startPuzzle(0);
};
$("delSet").onclick = async () => {
  if (!meta) return;
  if (!armed.del) { armed.del = true; armed.reset = false; renderPanel(); return; }
  armed.del = false;
  await delRec("meta", meta.id);
  await delRec("data", meta.id);
  metas = metas.filter((m) => m.id !== meta.id);
  meta = null; S = null; puzzles = []; fb = null;
  fillSelect();
  render();
};
document.addEventListener("click", (e) => {
  if (!e.target.closest("#reset,#delSet") && (armed.reset || armed.del)) { armed.reset = armed.del = false; renderPanel(); }
});

// ---------- modos: treino / revisão / relâmpago ----------
function stopBlitz() { if (blitzTimer) clearInterval(blitzTimer); blitzTimer = null; blitz = null; }
function startBlitz() {
  if (!puzzles.length) { setFb("info", "Importe um PGN de puzzles primeiro."); render(); return; }
  stopBlitz();
  const dur = Number($("bzDur").value) * 60;
  mode = "blitz";
  blitz = { dur, end: Date.now() + dur * 1000, score: 0, errors: 0, over: false };
  blitzTimer = setInterval(() => {
    if (!blitz) return;
    if (blitz.end - Date.now() <= 0) endBlitz(); else renderStats();
  }, 250);
  setFb("info", "Valendo! Resolva o máximo que puder. Erro = −10 s.");
  nextBlitz();
}
function nextBlitz() {
  if (!blitz || blitz.over) return;
  let i = Math.floor(Math.random() * puzzles.length);
  if (puzzles.length > 1 && i === pi) i = (i + 1) % puzzles.length;
  startPuzzle(i, false);
}
function endBlitz() {
  if (!blitz || blitz.over) return;
  clearInterval(blitzTimer); blitzTimer = null;
  blitz.over = true; locked = true; token++;
  const key = String(blitz.dur / 60);
  const prevBest = blitzBest[key] || 0;
  const rec = blitz.score > prevBest;
  if (rec) { blitzBest[key] = blitz.score; putRec("prefs", { id: "blitz", best: blitzBest }); }
  setFb("info", `Tempo esgotado! Pontos: ${blitz.score} · Erros: ${blitz.errors}${rec ? " · Novo recorde!" : ` · Recorde: ${prevBest}`}`);
  render();
}
function setMode(m) {
  if (m === "blitz") { startBlitz(); return; }
  if (m === mode) return;
  const wasBlitz = mode === "blitz";
  stopBlitz();
  mode = m;
  if (!meta) { render(); return; }
  if (m === "review") {
    const due = dueList();
    if (!due.length) {
      setFb("info", "Nenhuma revisão pendente hoje.");
      if (wasBlitz) startPuzzle(pi, false); else render();
      return;
    }
    startPuzzle(due[0]);
    return;
  }
  startPuzzle(Math.min(meta.pos || 0, puzzles.length - 1));
}
$("mTrain").onclick = () => setMode("train");
$("mRev").onclick = () => setMode("review");
$("mBlitz").onclick = () => setMode("blitz");

// ---------- início ----------
onLook(() => render());
export const ready = (async () => {
  await storeReady;
  await lookReady;
  blitzBest = (await getOne("prefs", "blitz"))?.best || {};
  metas = (await getAll("meta")).sort((a, b) => a.created - b.created);
  fillSelect();
  render(); // abre com o tabuleiro limpo; o conjunto é escolhido na lista
})();
