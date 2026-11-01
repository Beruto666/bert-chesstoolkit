import "./i18n.js";
import "./profile.js";
import "./profiles.js";
import { libCount, libReady, openConfig, setOpenPgn, refreshLib } from "./library.js";
import { ready as puzReady, puzzlesInfo } from "./puzzles.js";
import { fitBoard } from "./look.js";
import * as ana from "./analysis.js";
import * as dbv from "./dbview.js";
import * as rp from "./rep.js";
import * as tr from "./train.js";
import * as gs from "./guess.js";
import { enhanceAll } from "./dropdown.js";
enhanceAll();
import { ls, askChoice } from "./util.js";

const $ = (id) => document.getElementById(id);

function refreshHome() {
  const n = libCount();
  $("homeLib").textContent = n ? `${n} ${n === 1 ? "item" : "itens"} na biblioteca` : "Seus livros e PGNs";
  const { sets, due } = puzzlesInfo();
  $("homePuz").textContent = sets
    ? `${due} ${due === 1 ? "revisão" : "revisões"} hoje · ${sets} ${sets === 1 ? "conjunto" : "conjuntos"}`
    : "Importe um PGN para começar";
  const ri = rp.repInfo();
  $("homeRep").textContent = ri.reps ? `${ri.due} ${ri.due === 1 ? "posição" : "posições"} para revisar · ${ri.reps} ${ri.reps === 1 ? "repertório" : "repertórios"}` : "Treine suas aberturas com variantes";
  $("homeBoard").textContent = ana.hasUnsaved() ? "Há uma análise não salva" : "Análise, anotações e PGN";
}
function show(view) {
  if (view !== "ana" && document.getElementById("view-ana").classList.contains("on")) ana.hide();
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("on", el.id === `view-${view}`));
  if (view === "home") refreshHome();
  if (view === "lib") refreshLib();
  if (view === "ana") ana.show();
  if (view === "db") dbv.refresh();
  if (view === "rep") rp.show();
  if (view === "train") tr.show();
  if (view === "guess") gs.show();
  window.scrollTo(0, 0);
  requestAnimationFrame(fitBoard);
}

$("goLib").onclick = () => show("lib");
$("goPuz").onclick = () => show("puz");
$("goDb").onclick = () => show("db");
$("goRep").onclick = () => show("rep");
$("goTrain").onclick = () => show("train");
$("goGuess").onclick = () => show("guess");
gs.init({ open: async (text, title) => { if (await ana.openText(text, title)) show("ana"); } });
tr.init(async (fen, title, color, goal) => { show("ana"); await ana.startEndgame(fen, title, color, goal); });
document.addEventListener("train-rep", async (e) => { if (await rp.createFrom(e.detail.pgn, e.detail.name)) show("rep"); });
rp.setOpenAna(async (rec) => { if (await ana.openRepertoire(rec)) show("ana"); });
document.addEventListener("goto-rep", () => show("rep"));
document.addEventListener("goto-db", () => show("db"));
$("goBoard").onclick = async () => { if (await ana.newBoard()) show("ana"); };
dbv.setOpen(async (text, title, ply) => { if (await ana.openText(text, title, ply)) show("ana"); });
document.querySelectorAll("[data-back]").forEach((b) => { b.onclick = () => show("home"); });
// PGN da biblioteca abre direto na análise, sem programa externo
setOpenPgn(async (id, title) => { if (await ana.openFile(id, title)) show("ana"); });

Promise.all([libReady, puzReady, rp.ready]).then(refreshHome);

// aviso (uma vez por abertura) se o curl não estiver instalado
(async () => {
  if (ls.get("noCurlWarn") === "1") return;
  try { if ((await window.__TAURI__.core.invoke("have_curl")) !== false) return; } catch { return; }
  const c = await askChoice("curl não encontrado", "O app usa o programa curl para baixar o Stockfish, as partidas do Lichess/Chess.com e a lista de aberturas. Instale com: sudo pacman -S curl (Arch/CachyOS), sudo apt install curl (Debian/Ubuntu) ou sudo dnf install curl (Fedora). O resto do app funciona normalmente sem ele.", ["Entendi", "Não avisar de novo"]);
  if (c === 1) ls.set("noCurlWarn", "1");
})();

// sem seleção de texto nem arrastar imagens fora dos campos de texto
document.addEventListener("selectstart", (e) => { const t = e.target.nodeType === 1 ? e.target : e.target.parentElement; if (!t?.closest("input,textarea,[contenteditable],.sel")) e.preventDefault(); });
document.addEventListener("dragstart", (e) => { if (!e.target.closest?.("input,textarea")) e.preventDefault(); });

// F11: tela cheia (no Windows esconde também a barra de tarefas); F11 de novo volta
document.addEventListener("keydown", async (e) => {
  if (e.key !== "F11") return;
  e.preventDefault();
  try { const w = window.__TAURI__.window.getCurrentWindow(); await w.setFullscreen(!(await w.isFullscreen())); } catch (_) {}
});
