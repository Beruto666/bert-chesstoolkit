// Jogar contra o Stockfish com Elo ajustável. Os lances entram na árvore da Análise.
import { Chess } from "./vendor/chess.js";
import { $, esc, ls, toast } from "./util.js";
import * as E from "./engine.js";
import { play as sfx } from "./sound.js";

let H = null; // ganhos da tela de análise
let P = null; // partida em curso
const DEF = { elo: 1600, ms: 1000, col: "w", from: "cur", tutor: false };
const cfg = () => { try { return { ...DEF, ...JSON.parse(ls.get("playCfg") || "{}") }; } catch { return { ...DEF }; } };

export const active = () => !!P;
// o tabuleiro só deixa mexer as peças do jogador, na vez dele
export const allows = (turn) => !P || (!P.over && !P.thinking && P.color === turn);
const turnOf = (fen) => fen.split(" ")[1];

export function init(hooks) {
  H = hooks;
  $("abPlay").onclick = () => (P ? toast("Já há uma partida em curso. Use “Encerrar”.") : openSetup());
  $("plBack").onclick = takeback;
  $("plRes").onclick = resign;
  $("plStop").onclick = () => stop();
  $("plElo").oninput = syncSetup;
  $("plNo").onclick = () => $("playDlg").close();
  $("plGo").onclick = start;
  $("plWarn").onclick = warnClick;
  $("plTb").onclick = tablebase;
}

// ---------- configuração ----------
function syncSetup() {
  const r = E.eloRange(), elo = Number($("plElo").value);
  $("plEloV").textContent = !r ? "indisponível" : elo >= r.max ? "força máxima" : `${elo}`;
}
async function openSetup() {
  const c = cfg();
  $("plNote").textContent = "";
  try { await E.ensure(); } catch {}
  const r = E.eloRange();
  $("plElo").disabled = !r;
  if (r) { $("plElo").min = r.min; $("plElo").max = r.max; $("plNote").textContent = E.state.name ? `Motor: ${E.state.name}` : ""; }
  else $("plNote").textContent = `${E.state.name || "Este motor"} não oferece limite de força (UCI_Elo): ele jogará com a força máxima.`;
  $("plElo").value = Math.max(r ? r.min : 1320, Math.min(r ? r.max : 3190, c.elo));
  $("plTutor").checked = !!c.tutor; $("plMs").value = String(c.ms); $("plCol").value = c.col; $("plFrom").value = c.from;
  syncSetup();
  $("playDlg").showModal();
}

// ---------- partida ----------
async function start() {
  const c = { elo: Number($("plElo").value), ms: Number($("plMs").value), col: $("plCol").value, from: $("plFrom").value, tutor: $("plTutor").checked };
  ls.set("playCfg", JSON.stringify(c));
  $("playDlg").close();
  return begin(c);
}
// treino de finais: força máxima, a partir da posição atual, com objetivo (win/draw)
export function startPreset(c, goal) {
  if (P) return toast("Já há uma partida em curso.");
  return begin({ elo: 99999, ms: 1000, tutor: false, from: "cur", ...c }, goal);
}
async function begin(c, goal) {
  if (c.from === "new" && !(await H.newGame())) return;
  const color = c.col === "r" ? (Math.random() < 0.5 ? "w" : "b") : c.col;
  const node = H.cur();
  if (new Chess(node.fen).isGameOver()) { toast("Essa posição já está terminada. Escolha outra."); return; }
  const rng = E.eloRange(), full = !rng || c.elo >= rng.max, eng = (E.state.name || "Stockfish").replace(/\s+\d.*$/, "");
  const name = full ? eng : `${eng} (Elo ${c.elo})`;
  P = { color, elo: full ? null : c.elo, ms: c.ms, name, seq: 0, thinking: false, over: false, result: "", tutor: c.tutor, skip: new Set(), warn: null, goal: goal || null };
  document.body.classList.add("playing");
  H.pause(true);
  $("abPlayBar").hidden = false;
  status("Iniciando o motor…");
  try {
    await E.ensure();
  } catch (e) {
    const m = String(e?.message || e);
    await stop(true);
    toast(m === "not-installed" ? "Stockfish não encontrado. Baixe-o em ⚙ na Análise." : m, 6000);
    return;
  }
  H.flip(color);
  if (H.header("White") === "?" || !H.header("White")) H.setHeaders({ [color === "w" ? "White" : "Black"]: "Você", [color === "w" ? "Black" : "White"]: name });
  H.refresh();
  afterMove();
}

function endText(chess) {
  if (chess.isCheckmate()) return chess.turn() === "w" ? ["0-1", "Xeque-mate. As pretas vencem."] : ["1-0", "Xeque-mate. As brancas vencem."];
  if (chess.isStalemate()) return ["1/2-1/2", "Empate por afogamento."];
  if (chess.isInsufficientMaterial()) return ["1/2-1/2", "Empate por material insuficiente."];
  if (chess.isThreefoldRepetition()) return ["1/2-1/2", "Empate por repetição."];
  if (chess.isDraw()) return ["1/2-1/2", "Empate (regra dos 50 lances)."];
  return null;
}
export const endStats = () => { try { return JSON.parse(ls.get("endStats") || "{}"); } catch { return {}; } };
function recordEnd(id, ok) { const s = endStats(), r = s[id] || { n: 0, w: 0 }; r.n++; if (ok) r.w++; s[id] = r; ls.set("endStats", JSON.stringify(s)); }
function finish(result, text) {
  P.over = true; P.thinking = false; P.result = result; P.seq++;
  sfx("end");
  E.stopSearch();
  H.setHeaders({ Result: result });
  const mine = (result === "1-0" && P.color === "w") || (result === "0-1" && P.color === "b");
  let extra = result === "1/2-1/2" ? "" : mine ? "Você venceu!" : "O motor venceu.";
  if (P.goal) {
    const ok = P.goal.type === "draw" ? result === "1/2-1/2" || mine : mine;
    recordEnd(P.goal.id, ok);
    extra += ok ? " ✔ Objetivo cumprido!" : " ✘ Não deu dessa vez — tente de novo.";
  }
  status(`${text} ${extra}`);
  $("plBack").disabled = false;
}
// chamada depois de cada lance (do jogador ou do motor): confere o fim e, se for a vez do motor, joga
function afterMove() {
  if (!P || P.over) return;
  const chess = new Chess(H.cur().fen), end = endText(chess);
  if (end) { finish(...end); return; }
  if (chess.turn() === P.color) status("Sua vez.");
  else {
    const node = H.cur();
    if (P.tutor && node.parent && !P.skip.has(node)) tutor(node);
    else engineMove();
  }
}
// Tutor: compara a posição antes e depois do seu lance (força máxima); se perder muito, avisa e segura o motor.
const TUTOR_LOSS = 12;
function hideWarn() { $("plWarn").hidden = true; $("plWarn").innerHTML = ""; if (P) P.warn = null; }
async function tutor(node) {
  const my = ++P.seq;
  P.thinking = true;
  status("Tutor avaliando o seu lance…");
  try { await E.ensure(); } catch { P.thinking = false; P.skip.add(node); engineMove(); return; }
  const a = await E.searchOnce(node.parent.fen, { multipv: 1, movetime: 600, elo: null });
  if (!P || my !== P.seq) return;
  const b = await E.searchOnce(node.fen, { multipv: 1, movetime: 600, elo: null });
  if (!P || my !== P.seq) return;
  P.thinking = false;
  P.skip.add(node);
  if (a?.[1] && b?.[1]) {
    const ea = E.toWhite(node.parent.fen, a[1]), eb = E.toWhite(node.fen, b[1]);
    const mine = (e) => (P.color === "w" ? E.winPct(e) : 100 - E.winPct(e));
    const loss = mine(ea) - mine(eb);
    if (loss >= TUTOR_LOSS) {
      let best = a[1].pv?.[0] || "";
      try { const c = new Chess(node.parent.fen); const m = c.move({ from: best.slice(0, 2), to: best.slice(2, 4), promotion: best[4] }); best = m.san; } catch {}
      P.warn = node;
      $("plWarn").hidden = false;
      $("plWarn").innerHTML = `<span>⚠ Tutor: esse lance perde cerca de ${Math.round(loss)}% de chance (${E.evalText(ea)} → ${E.evalText(eb)}). Melhor era <b>${esc(best)}</b>.</span><button data-a="undo">Desfazer</button><button class="ghost" data-a="go">Seguir assim</button>`;
      status("Tutor: veja o aviso.");
      return;
    }
  }
  engineMove();
}
// Tablebase do Lichess: resultado teórico (do lado a jogar) e melhor lance para a posição atual
const CAT = { win: "vitória", loss: "derrota", draw: "empate", "cursed-win": "vitória anulada pela regra dos 50 lances (empate)", "blessed-loss": "derrota que vira empate pela regra dos 50 lances", unknown: "desconhecido" };
async function tablebase() {
  if (!H) return;
  if (P?.warn) { toast("Resolva primeiro o aviso do tutor."); return; }
  const fen = H.cur().fen, side = turnOf(fen) === "w" ? "brancas" : "pretas", other = side === "brancas" ? "pretas" : "brancas";
  const n = fen.split(" ")[0].replace(/[^a-zA-Z]/g, "").length;
  const show = (t) => { $("plWarn").hidden = false; $("plWarn").innerHTML = `<span>${t}</span><button data-a="close" class="ghost">Fechar</button>`; };
  if (n > 7) { show(`Tablebase: só funciona com até 7 peças (aqui há ${n}).`); return; }
  show("Consultando a tablebase…");
  let r;
  try { r = await window.__TAURI__.core.invoke("http_get", { url: "https://tablebase.lichess.ovh/standard?fen=" + encodeURIComponent(fen) }); } catch (e) { show("Não consegui consultar a tablebase: " + esc(String(e))); return; }
  if (r.status !== 200) { show(r.status === 0 ? "Sem internet para consultar a tablebase." : `A tablebase respondeu ${r.status}.`); return; }
  let d;
  try { d = JSON.parse(r.body); } catch { show("Resposta inesperada da tablebase."); return; }
  const cat = d.category || "unknown";
  let txt = cat === "win" ? `${side} vencem` : cat === "loss" ? `${other} vencem` : CAT[cat] || cat;
  if (d.dtm != null && (cat === "win" || cat === "loss")) txt += ` (mate em ${Math.abs(d.dtm)} lances com jogo perfeito)`;
  const best = d.moves?.[0]?.san;
  show(`Tablebase: ${esc(txt)}.${best ? ` Melhor lance: <b>${esc(best)}</b>.` : ""}`);
}
function warnClick(e) {
  const b = e.target.closest("[data-a]");
  if (b?.dataset.a === "close") { hideWarn(); return; }
  if (!b || !P || !P.warn) return;
  const node = P.warn;
  hideWarn();
  if (b.dataset.a === "undo") { P.skip.delete(node); H.go(node.parent); status("Sua vez."); } else engineMove();
}
export const afterUserMove = afterMove;
async function engineMove() {
  const node = H.cur(), my = ++P.seq;
  P.thinking = true;
  status(`${esc(P.name)} está pensando…`);
  try { await E.ensure(); } catch (e) { if (P && my === P.seq) { P.thinking = false; status("O motor não iniciou. Use “Encerrar”."); } return; }
  if (!P || my !== P.seq) return;
  const best = await E.bestMove(node.fen, { elo: P.elo, movetime: P.ms });
  if (!P || my !== P.seq) return; // cancelado (voltou lance, encerrou…)
  P.thinking = false;
  if (!best) { status("O motor não respondeu. Tente “Voltar lance” ou “Encerrar”."); return; }
  if (H.cur() !== node) H.go(node);
  try { H.playUci(best); } catch { status("O motor devolveu um lance inválido. Use “Voltar lance” ou “Encerrar”."); return; }
  afterMove();
}

function status(html) {
  if (!P) return;
  const side = P.color === "w" ? "brancas" : "pretas";
  $("plStat").innerHTML = `<b>Você (${side})</b> × ${esc(P.name)}<span>${html}</span>`;
}
function takeback() {
  if (!P) return;
  hideWarn();
  P.seq++; P.thinking = false; E.stopSearch();
  let n = H.cur();
  const start = n;
  if (n.parent && (P.over || turnOf(n.fen) === P.color)) n = n.parent;
  while (n.parent && turnOf(n.fen) !== P.color) n = n.parent;
  P.over = false;
  if (n !== start) H.go(n);
  afterMove();
}
function resign() {
  if (!P || P.over) return;
  finish(P.color === "w" ? "0-1" : "1-0", "Você desistiu.");
}
export async function stop(silent) {
  if (!P && !silent) return;
  if (P) P.seq++;
  P = null;
  hideWarn();
  E.stopSearch();
  document.body.classList.remove("playing");
  $("abPlayBar").hidden = true;
  H?.pause(false);
}
// a tela de análise foi escondida: o processo do motor é encerrado; ao voltar, retoma
export function onHide() { if (P) { P.seq++; P.thinking = false; } }
export function onShow() { if (P && !P.over) afterMove(); }
