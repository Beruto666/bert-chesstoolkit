// Treinos: finais clássicos contra o motor e treino de coordenadas (visão do tabuleiro).
import { $, esc, ls, FILES, toast, askForm, askChoice } from "./util.js";
import { endStats } from "./play.js";
import { Chess } from "./vendor/chess.js";

// Só posições de teoria conhecida (você joga com o lado forte, de brancas, e deve vencer).
const ENDGAMES = [
  { id: "kq", name: "Dama e rei contra rei", desc: "O mate básico: encurrale o rei sem afogar.", fen: "8/8/8/4k3/8/8/8/3QK3 w - - 0 1" },
  { id: "kr", name: "Torre e rei contra rei", desc: "Mate com a torre, usando a oposição e o “corte”.", fen: "8/8/8/4k3/8/8/8/R3K3 w - - 0 1" },
  { id: "kbb", name: "Dois bispos contra rei", desc: "Dois bispos de cores diferentes empurram o rei para o canto.", fen: "8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1" },
  { id: "kbn", name: "Bispo e cavalo contra rei", desc: "O mate mais difícil dos básicos — vá ao canto da cor do bispo.", fen: "8/8/8/4k3/8/8/8/1N2KB2 w - - 0 1" },
  { id: "krr", name: "Duas torres contra rei (escada)", desc: "Uma torre corta, a outra dá xeque: empurre o rei até a borda.", fen: "8/8/8/4k3/8/8/8/R3K2R w - - 0 1" },
  { id: "p6", name: "Rei à frente do peão na 6ª", desc: "Rei na 6ª fileira, na frente do peão: vence mesmo sem a vez. Promova!", fen: "3k4/8/3K4/3P4/8/8/8/8 w - - 0 1" },
  { id: "lucena", name: "Posição de Lucena", desc: "Torre e peão na 7ª: construa a “ponte” para promover.", fen: "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1" },
];

const stat = (id) => { const s = endStats()[id]; return s ? `${s.w} de ${s.n} vitória${s.n === 1 ? "" : "s"}` : "ainda não tentado"; };
let startEndgame = null;
export function init(fn) { startEndgame = fn; }

// posições do usuário e padrões escondidos ficam no navegador do app
const jget = (k, d) => { try { return JSON.parse(ls.get(k) || "") ?? d; } catch { return d; } };
const custom = () => jget("customEndgames", []);
const hidden = () => jget("hiddenEndgames", []);
const all = () => [...ENDGAMES.filter((e) => !hidden().includes(e.id)), ...custom()];
function renderEnd() {
  const list = all();
  $("trEnd").innerHTML = list.map((e) => `<div class="trw"><button class="trrow" data-e="${esc(e.id)}"><span><b>${esc(e.name)}</b><small>${esc(e.desc || "")}</small></span><em>${esc(stat(e.id))}</em></button><button class="ghost trx" data-x="${esc(e.id)}" title="Remover esta posição" aria-label="Remover">×</button></div>`).join("")
    + `<div class="trbar"><button class="ghost" id="trAdd">+ Adicionar posição</button>${hidden().length ? `<button class="ghost" id="trRestore" title="Traz de volta os finais que você removeu">Restaurar padrões</button>` : ""}</div>`;
}
$("trEnd").addEventListener("click", async (e) => {
  if (e.target.closest("#trAdd")) return addEnd();
  if (e.target.closest("#trRestore")) { ls.set("hiddenEndgames", "[]"); renderEnd(); return; }
  const x = e.target.closest("[data-x]");
  if (x) {
    const id = x.dataset.x, g = all().find((v) => v.id === id);
    if (!g || (await askChoice("Remover posição", `Remover “${g.name}” da lista de finais?`, ["Remover", "Cancelar"])) !== 0) return;
    if (custom().some((c) => c.id === id)) ls.set("customEndgames", JSON.stringify(custom().filter((c) => c.id !== id)));
    else ls.set("hiddenEndgames", JSON.stringify([...hidden(), id]));
    renderEnd();
    return;
  }
  const b = e.target.closest("[data-e]");
  const g = b && all().find((v) => v.id === b.dataset.e);
  if (g && startEndgame) startEndgame(g.fen, g.name, new Chess(g.fen).turn(), { id: g.id, type: "win" });
});
async function addEnd() {
  const r = await askForm("Nova posição de final", [
    { key: "name", label: "Nome", placeholder: "Ex.: Torre contra bispo" },
    { key: "desc", label: "Descrição (opcional)", placeholder: "Ex.: Posição teórica de empate: defenda com precisão." },
    { key: "fen", label: "Posição em FEN (você joga com o lado que tem a vez e deve vencer)", placeholder: "8/8/8/4k3/8/8/8/R3K3 w - - 0 1" },
  ], "Adicionar");
  if (!r) return;
  const name = r.name.trim(), fen = r.fen.trim();
  if (!name) { toast("Dê um nome à posição."); return; }
  try { new Chess(fen); } catch { toast("FEN inválido."); return; }
  ls.set("customEndgames", JSON.stringify([...custom(), { id: "c" + Date.now().toString(36), name, desc: r.desc.trim(), fen }]));
  renderEnd();
}
// ---------- coordenadas ----------
const C = { orient: "w", on: false, score: 0, miss: 0, left: 30, target: "", timer: 0, hints: false };
const best = () => Number(ls.get("coordBest_" + C.orient) || 0);
function drawBoard() {
  const rows = C.orient === "w" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const cols = C.orient === "w" ? [...FILES] : [...FILES].reverse();
  let h = "";
  for (const r of rows) for (const f of cols) {
    const dark = (FILES.indexOf(f) + r) % 2 === 0;
    h += `<button class="cosq ${dark ? "d" : "l"}" data-sq="${f}${r}">${C.hints ? `<i>${f}${r}</i>` : ""}</button>`;
  }
  $("coBoard").innerHTML = h;
}
function next() {
  let t; do { t = FILES[Math.floor(Math.random() * 8)] + (1 + Math.floor(Math.random() * 8)); } while (t === C.target);
  C.target = t; $("coTarget").textContent = t;
}
function info() { $("coInfo").textContent = C.on ? `Tempo: ${C.left}s · Acertos: ${C.score} · Erros: ${C.miss}` : `Recorde (${C.orient === "w" ? "brancas" : "pretas"}): ${best()}`; }
function end() {
  clearInterval(C.timer); C.on = false;
  const rec = C.score > best();
  if (rec) ls.set("coordBest_" + C.orient, String(C.score));
  $("coTarget").textContent = "—";
  $("coMsg").textContent = `Fim! ${C.score} acerto${C.score === 1 ? "" : "s"}, ${C.miss} erro${C.miss === 1 ? "" : "s"}.${rec ? " Novo recorde! 🎉" : ""}`;
  $("coStart").disabled = false; info();
}
$("coStart").onclick = () => {
  C.on = true; C.score = 0; C.miss = 0; C.left = 30; $("coMsg").textContent = ""; $("coStart").disabled = true;
  next(); info();
  C.timer = setInterval(() => { C.left--; info(); if (C.left <= 0) end(); }, 1000);
};
$("coBoard").addEventListener("click", (e) => {
  const b = e.target.closest("[data-sq]");
  if (!b || !C.on) return;
  if (b.dataset.sq === C.target) { C.score++; b.classList.add("ok"); next(); } else { C.miss++; b.classList.add("bad"); }
  setTimeout(() => b.classList.remove("ok", "bad"), 250);
  info();
});
$("coSide").onchange = (e) => { if (C.on) end(); C.orient = e.target.value; drawBoard(); info(); };
const setBig = (on) => { $("coCard").classList.toggle("big", on); $("coBig").textContent = on ? "Reduzir" : "Ampliar"; ls.set("coBig", on ? "1" : "0"); };
$("coBig").onclick = () => setBig(!$("coCard").classList.contains("big"));
setBig(ls.get("coBig") === "1");
$("coHints").onchange = (e) => { C.hints = e.target.checked; drawBoard(); };

export function show() { if (C.on) end(); renderEnd(); drawBoard(); info(); $("coTarget").textContent = "—"; $("coMsg").textContent = ""; }
