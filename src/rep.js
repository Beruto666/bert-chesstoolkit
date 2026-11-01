// Treino de repertório: importe um PGN com variantes (ou use o da Análise) e treine seu lado do tabuleiro.
// Estudar = guiado (mostra o lance); Treinar = linha inteira dando nota; Revisão = posições vencidas (repetição espaçada).
import { $, ic, esc, ls, toast, sleep, askChoice, askForm, pgnPicker } from "./util.js";
import { getAll, putRec, delRec, storeReady } from "./store.js";
import { Board } from "./board.js";
import { onLook, lookReady } from "./look.js";
import { Repertoire, RepSession, repStats, dueCards, pickLine, dstr } from "./repcore.js";

let reps = [], rec = null, rep = null, S = null;
let mode = "study", chapter = -1, studyIdx = 0, queue = [];
let fb = null, hintShape = null, wrongHere = 0, busy = false, token = 0, armed = { reset: false, del: false };
let openAna = null;
export const setOpenAna = (fn) => { openAna = fn; };

const board = new Board($("rpBoard"), {
  canMove: (sq) => !busy && !!S && S.userTurn && board.pieces[sq]?.color === S.rep.color,
  targets: (sq) => (S ? S.targets(sq).map((m) => ({ to: m.to, capture: m.captured !== undefined })) : []),
  onMove: (from, to) => onMove(from, to),
  color: () => "G",
});
onLook(() => board.render());

// ---------- dados ----------
export const ready = (async () => {
  await storeReady;
  reps = (await getAll("reps")).sort((a, b) => (b.created || 0) - (a.created || 0));
  rec = null; // abre com o tabuleiro limpo; o repertório é escolhido na lista
  buildRep();
})();
export function repInfo() {
  const t = dstr();
  return { reps: reps.length, due: reps.reduce((n, r) => n + Object.values(r.srs || {}).filter((v) => v.due <= t).length, 0) };
}
const save = () => rec && putRec("reps", rec);
function buildRep() {
  rep = null;
  if (rec) { try { rep = new Repertoire(rec.pgn, rec.color); } catch { rep = null; } }
}
async function createRep(name, pgn, color, allowEmpty = false) {
  let r;
  try { r = new Repertoire(pgn, color); } catch { r = null; }
  if (!r || (!r.lines.length && !allowEmpty)) { toast("Não encontrei lances nesse PGN."); return false; }
  rec = { id: "rep" + Date.now(), name: name || "Repertório", color, pgn, srs: {}, created: Date.now() };
  reps.unshift(rec);
  await save();
  ls.set("repLast", rec.id);
  buildRep(); mode = "study"; chapter = -1; studyIdx = 0; queue = [];
  return true;
}
// chamado pela Análise: cria um repertório a partir do PGN atual e pergunta a cor
export async function createFrom(pgn, name) {
  const c = await askChoice("Treinar repertório", "Você joga com qual cor neste repertório?", ["Brancas", "Pretas", "Cancelar"]);
  if (c !== 0 && c !== 1) return false;
  return createRep(name, pgn, c === 0 ? "w" : "b");
}

// Construir um repertório do zero: abre a Análise vazia, orientada para a sua cor; Salvar grava aqui.
async function newRepertoire() {
  const f = await askForm("Novo repertório", [{ key: "name", label: "Nome (ex.: Italiana com brancas)", value: "" }], "Continuar");
  if (!f || !f.name.trim()) return;
  const c = await askChoice("Novo repertório", "Você joga com qual cor neste repertório?", ["Brancas", "Pretas", "Cancelar"]);
  if (c !== 0 && c !== 1) return;
  const name = f.name.trim();
  const pgn = `[Event "${name.replace(/"/g, "'")}"]\n[White "Repertório"]\n[Black "?"]\n[Result "*"]\n\n*\n`;
  if (!(await createRep(name, pgn, c === 0 ? "w" : "b", true))) return;
  S = null;
  if (openAna) openAna(rec);
}
// a Análise salvou o repertório que estava editando
document.addEventListener("save-rep", async (e) => {
  const r = reps.find((x) => x.id === e.detail.id);
  if (!r) return;
  r.pgn = e.detail.pgn;
  await putRec("reps", r);
  if (rec && rec.id === r.id) { buildRep(); queue = []; S = null; }
});

// ---------- tabuleiro ----------
function kingSq() {
  if (!S || !S.chess.isCheck()) return null;
  const t = S.chess.turn();
  const rows = S.chess.board();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = rows[r][c]; if (p && p.type === "k" && p.color === t) return "abcdefgh"[c] + (8 - r); }
  return null;
}
function shapes() {
  if (hintShape) return hintShape.to ? [{ t: "a", f: hintShape.from, to: hintShape.to, c: "G" }] : [{ t: "c", f: hintShape.from, c: "G" }];
  if (S && mode === "study" && S.userTurn) { const h = S.hint(); if (h) return [{ t: "a", f: h.from, to: h.to, c: "G" }]; }
  return [];
}
function setBoard(initial = false) {
  const patch = { fen: S ? S.fen : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", last: S ? S.last : null, check: kingSq(), shapes: shapes(), orient: rep ? rep.color : "w" };
  if (initial) patch.reset = true;
  board.set(patch);
}

// ---------- fluxo ----------
const lineList = () => (rep ? rep.lines.filter((l) => chapter < 0 || l.chapter === chapter) : []);
async function begin() {
  const my = ++token;
  fb = null; hintShape = null; wrongHere = 0; busy = false;
  if (!rep) { S = null; setBoard(true); render(); return; }
  if (!rep.lines.length) { S = null; fb = { kind: "info", text: "Este repertório ainda está vazio. Clique em “Editar / construir” e jogue os lances no tabuleiro: o primeiro lance de cada resposta é a linha principal, e lances alternativos viram variantes. Depois salve e volte para treinar." }; setBoard(true); render(); return; }
  if (mode === "review") {
    if (!queue.length) queue = dueCards(rep, rec.srs).map((c) => c.key);
    const card = queue.length ? rep.pos.get(queue[0]) : null;
    if (!card) { S = null; fb = { kind: "info", text: "Nenhuma posição para revisar agora. Treine mais linhas ou volte amanhã." }; setBoard(true); render(); return; }
    S = new RepSession(rep, { mode: "review", card, srs: rec.srs });
  } else {
    const lines = lineList();
    if (!lines.length) { S = null; setBoard(true); render(); return; }
    const line = mode === "study" ? lines[studyIdx % lines.length] : pickLine(rep, rec.srs, chapter);
    S = new RepSession(rep, { mode, line, srs: rec.srs });
  }
  setBoard(true);
  render();
  await runOpponent(my);
  if (my === token) render();
}
async function runOpponent(my = token) {
  busy = true;
  while (S && S.needsOpponent && my === token) {
    await sleep(420);
    if (my !== token) return;
    const m = S.opponentStep();
    if (!m) break;
    hintShape = null;
    setBoard();
    if (m.comment) fb = { kind: "info", text: m.comment };
    render();
  }
  if (my !== token) return;
  busy = false;
  if (S && S.done) finish();
  setBoard();
  render();
}
function finish() {
  if (!S) return;
  if (mode === "study") fb = { kind: "right", title: "Linha concluída", text: fb && fb.text ? fb.text : "" };
  else if (mode === "train") fb = { kind: S.mistakes ? "wrong" : "right", title: S.mistakes ? `Linha concluída com ${S.mistakes} ${S.mistakes === 1 ? "erro" : "erros"}` : "Linha concluída sem erros!", text: fb && fb.text ? fb.text : "" };
  else fb = { kind: S.failed.size ? "wrong" : "right", title: S.failed.size ? "Errou: essa posição volta hoje" : "Correto! Volta mais tarde", text: fb && fb.text ? fb.text : "" };
  save();
}
async function onMove(from, to) {
  if (!S || !S.userTurn || busy) { board.set({ reset: true }); return; }
  let promo = "";
  if (S.needsPromotion(from, to)) {
    promo = await board.askPromotion(S.rep.color);
    if (!promo) { board.set({ reset: true }); return; }
  }
  const r = S.tryMove(from, to, promo);
  if (r.status === "wrong") {
    wrongHere++;
    board.set({ reset: true });
    const first = wrongHere < 2;
    if (!first) { const h = S.hint(); hintShape = h ? { from: h.from, to: h.to } : null; }
    fb = { kind: "wrong", title: "Esse não é o lance do repertório", text: first ? "Tente de novo." : `No repertório: ${r.expected.join(" ou ")}` };
    setBoard(); await save(); render();
    return;
  }
  wrongHere = 0; hintShape = null;
  fb = r.comment ? { kind: "right", title: "Correto!", text: r.comment } : { kind: "right", title: "Correto!", text: "" };
  setBoard();
  render();
  if (S.done) { finish(); render(); await save(); return; }
  await save();
  await runOpponent();
}
async function next() {
  if (mode === "review") {
    if (S) { const k = queue.shift(); if (S.failed.has(k) && queue.length < 40) queue.push(k); }
  } else if (mode === "study") studyIdx++;
  await begin();
}

// ---------- tela ----------
function render() {
  const has = !!rep;
  $("rpSel").innerHTML = reps.length ? reps.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("").replace(/^/, `<option value="">Escolher repertório…</option>`) : `<option value="">Nenhum repertório — importe um PGN</option>`;
  $("rpSel").value = rec ? rec.id : "";
  $("rpColor").value = rec ? rec.color : "w";
  $("rpColor").disabled = !rec;
  for (const [id, m] of [["rpStudy", "study"], ["rpTrain", "train"], ["rpRev", "review"]]) $(id).className = mode === m ? "on" : "";
  const st = has ? repStats(rep, rec.srs) : { cards: 0, nw: 0, learned: 0, due: 0, lines: 0 };
  $("rpRev").innerHTML = `${ic("repeat")}Revisão (${st.due})`;
  $("rpChap").innerHTML = `<option value="-1">Todos os capítulos</option>` + (rep ? rep.titles.map((t, i) => `<option value="${i}">${esc(t)}</option>`).join("") : "");
  $("rpChap").value = String(chapter);
  $("rpChap").disabled = !has || mode === "review";
  $("rpStats").innerHTML = [["Posições", st.cards], ["Aprendidas", st.learned], ["Revisar", st.due], ["Novas", st.nw]].map(([k, v]) => `<div class="stat"><small>${k}</small><b>${v}</b></div>`).join("");
  let info = reps.length ? "Escolha um repertório na lista acima, ou crie outro com <b>+ Novo repertório</b>." : "Crie um repertório com <b>+ Novo repertório</b> (você monta jogando no tabuleiro) ou importe um PGN com variantes.";
  if (rec && rep) {
    const side = rec.color === "w" ? "brancas" : "pretas";
    if (mode === "review") info = `<b>${esc(rec.name)}</b><br>Revisão · você joga de ${side} · ${queue.length || st.due} ${((queue.length || st.due) === 1) ? "posição" : "posições"} na fila`;
    else { const n = lineList().length; info = `<b>${esc(rec.name)}</b><br>${mode === "study" ? "Linha " + (n ? (studyIdx % n) + 1 : 0) + " de " + n : n + " linhas"} · você joga de ${side}`; }
  }
  $("rpInfo").innerHTML = info;
  $("rpFb").innerHTML = fb ? `<div class="alert ${fb.kind}">${fb.title ? `<b>${esc(fb.title)}</b>` : ""}${esc(fb.text || "")}</div>` : "";
  const user = !!S && S.userTurn && !busy;
  $("rpHint").disabled = !user;
  $("rpSol").disabled = !user;
  $("rpAgain").disabled = !S;
  $("rpNext").disabled = !(S && S.done) && !(mode === "review" && !S && queue.length);
  $("rpNext").classList.toggle("pulse", !!(S && S.done));
  $("rpOpen").disabled = !rec;
  $("rpReset").textContent = armed.reset ? "Confirmar zerar?" : "Zerar progresso";
  $("rpDel").textContent = armed.del ? "Confirmar excluir?" : "Excluir repertório";
  $("rpReset").disabled = $("rpDel").disabled = !rec;
}
export function show() { ready.then(() => { if (!S) begin(); else { setBoard(); render(); } }); }

$("rpStudy").onclick = () => { mode = "study"; queue = []; begin(); };
$("rpTrain").onclick = () => { mode = "train"; queue = []; begin(); };
$("rpRev").onclick = () => { mode = "review"; queue = []; begin(); };
$("rpChap").onchange = (e) => { chapter = Number(e.target.value); studyIdx = 0; begin(); };
$("rpSel").onchange = (e) => { rec = reps.find((r) => r.id === e.target.value) || null; ls.set("repLast", rec ? rec.id : ""); buildRep(); queue = []; studyIdx = 0; chapter = -1; begin(); };
$("rpColor").onchange = async (e) => { if (!rec) return; rec.color = e.target.value; await save(); buildRep(); queue = []; studyIdx = 0; begin(); };
$("rpHint").onclick = () => { const h = S && S.hint(); if (!h) return; hintShape = hintShape && !hintShape.to ? { from: h.from, to: h.to } : { from: h.from }; setBoard(); render(); };
$("rpSol").onclick = async () => {
  if (!S || !S.userTurn || busy) return;
  const r = S.reveal();
  hintShape = null;
  fb = { kind: "wrong", title: `Lance do repertório: ${r.san}`, text: r.comment || "" };
  setBoard(); render(); await save();
  if (S.done) { finish(); fb.text = r.comment || ""; render(); await save(); return; }
  await runOpponent();
};
$("rpAgain").onclick = () => begin();
$("rpNext").onclick = () => next();
$("rpOpen").onclick = () => { if (rec && openAna) openAna(rec); };
$("rpNew").onclick = () => newRepertoire();
pgnPicker($("rpImp"), $("rpFile"), false, async (files) => {
  const f = files[0];
  if (f && (await createFrom(f.text, f.name.replace(/\.pgn$/i, "")))) begin();
});
$("rpReset").onclick = async () => {
  if (!rec) return;
  if (!armed.reset) { armed.reset = true; armed.del = false; render(); return; }
  armed.reset = false; rec.srs = {}; queue = []; await save(); toast("Progresso zerado"); begin();
};
$("rpDel").onclick = async () => {
  if (!rec) return;
  if (!armed.del) { armed.del = true; armed.reset = false; render(); return; }
  armed.del = false;
  await delRec("reps", rec.id);
  reps = reps.filter((r) => r.id !== rec.id);
  rec = null; ls.set("repLast", "");
  buildRep(); queue = []; studyIdx = 0; chapter = -1; begin();
};
document.addEventListener("click", (e) => { if (!e.target.closest("#rpReset,#rpDel") && (armed.reset || armed.del)) { armed.reset = armed.del = false; render(); } });
document.addEventListener("keydown", (e) => {
  if (!$("view-rep").classList.contains("on") || e.target.closest("input,select,textarea,dialog")) return;
  if ((e.key === "Enter" || e.key === " ") && !$("rpNext").disabled) { e.preventDefault(); next(); }
});
Promise.all([ready, lookReady]).then(() => { setBoard(true); render(); });
