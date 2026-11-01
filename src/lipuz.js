// Puzzles do Lichess: baixa o banco oficial (CC0) e cria conjuntos filtrados por tema, rating e quantidade.
import { Chess } from "./vendor/chess.js";
import { $, esc, ls, toast } from "./util.js";

const T = window.__TAURI__;
const invoke = (...a) => T.core.invoke(...a);

export const THEMES = {
  advancedPawn: "Peão avançado", advantage: "Vantagem", anastasiaMate: "Mate de Anastácia", arabianMate: "Mate árabe",
  attackingF2F7: "Ataque a f2/f7", attraction: "Atração", backRankMate: "Mate da última fileira", bishopEndgame: "Final de bispos",
  bodenMate: "Mate de Boden", capturingDefender: "Captura do defensor", castling: "Roque", clearance: "Liberação",
  crushing: "Esmagador", defensiveMove: "Lance defensivo", deflection: "Desvio", discoveredAttack: "Ataque descoberto",
  doubleBishopMate: "Mate dos dois bispos", doubleCheck: "Xeque duplo", dovetailMate: "Mate de cauda de andorinha",
  endgame: "Final", enPassant: "En passant", equality: "Igualdade", exposedKing: "Rei exposto", fork: "Garfo",
  hangingPiece: "Peça solta", hookMate: "Mate do gancho", interference: "Interferência", intermezzo: "Lance intermediário",
  kingsideAttack: "Ataque na ala do rei", knightEndgame: "Final de cavalos", long: "Longo (3 lances)", master: "Partidas de mestres",
  masterVsMaster: "Mestre contra mestre", mate: "Mate", mateIn1: "Mate em 1", mateIn2: "Mate em 2", mateIn3: "Mate em 3",
  mateIn4: "Mate em 4", mateIn5: "Mate em 5", middlegame: "Meio-jogo", oneMove: "Um lance", opening: "Abertura",
  pawnEndgame: "Final de peões", pin: "Cravada", promotion: "Promoção", queenEndgame: "Final de damas",
  queenRookEndgame: "Final de dama e torre", queensideAttack: "Ataque na ala da dama", quietMove: "Lance silencioso",
  rookEndgame: "Final de torres", sacrifice: "Sacrifício", short: "Curto (2 lances)", skewer: "Espetada",
  smotheredMate: "Mate sufocado", superGM: "Super GM", trappedPiece: "Peça presa", underPromotion: "Subpromoção",
  veryLong: "Muito longo (4+ lances)", vukovicMate: "Mate de Vukovic", xRayAttack: "Raio-X", zugzwang: "Zugzwang",
};
const themeText = (s) => s.split(" ").filter(Boolean).map((t) => THEMES[t] || t).join(", ");

// linha do CSV → puzzle do app. O 1º lance da lista é do adversário e leva à posição do puzzle.
function toPuzzle(r) {
  try {
    const ch = new Chess(r.fen);
    const ms = r.moves.split(" ").filter(Boolean);
    const first = ch.move({ from: ms[0].slice(0, 2), to: ms[0].slice(2, 4), promotion: ms[0][4] || undefined });
    if (!first) return null;
    const fen = ch.fen();
    const moves = [];
    for (const u of ms.slice(1)) {
      const m = ch.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
      if (!m) break;
      moves.push({ f: m.from, t: m.to, p: m.promotion || "", san: m.san, c: "" });
    }
    if (moves.length % 2 === 0) moves.pop(); // termina no lance de quem resolve
    if (!moves.length) return null;
    return { fen, moves, intro: "", title: `Lichess #${r.id} · rating ${r.rating}`, themes: themeText(r.themes), rating: r.rating };
  } catch { return null; }
}

let chosen = new Set(), busy = false, addSet = null;
const dlg = () => $("lpDlg");

function drawThemes() {
  const q = $("lpFind").value.trim().toLowerCase();
  $("lpThemes").innerHTML = Object.entries(THEMES)
    .filter(([k, v]) => !q || v.toLowerCase().includes(q) || k.toLowerCase().includes(q))
    .sort((a, b) => a[1].localeCompare(b[1], "pt"))
    .map(([k, v]) => `<button type="button" data-t="${k}" class="${chosen.has(k) ? "on" : ""}">${esc(v)}</button>`).join("");
  $("lpPicked").textContent = chosen.size ? `${chosen.size} tema${chosen.size > 1 ? "s" : ""}: ${[...chosen].map((k) => THEMES[k]).join(", ")}` : "Nenhum tema escolhido: vale qualquer um.";
}
async function refreshStatus() {
  let st;
  try { st = await invoke("lp_status"); } catch (e) { $("lpSt").textContent = String(e); return; }
  const has = !!st.file;
  $("lpSt").innerHTML = has ? `✔ Banco de puzzles baixado (${st.mb} MB). ${st.zstd ? "" : "<b>Falta o programa zstd</b> (ex.: <code>sudo pacman -S zstd</code>)."}` : `Banco ainda não baixado (≈250 MB, uma vez só; feito pelo curl).`;
  $("lpDl").textContent = has ? "Atualizar o banco" : "Baixar o banco";
  $("lpGo").disabled = !has || !st.zstd || busy;
}
async function download() {
  if (busy) { invoke("lp_cancel").catch(() => {}); return; }
  busy = true; $("lpDl").textContent = "Cancelar"; $("lpGo").disabled = true;
  const un = await T.event.listen("lp-progress", (e) => { $("lpMsg").textContent = e.payload; });
  try { await invoke("lp_download"); $("lpMsg").textContent = "Pronto!"; }
  catch (e) { $("lpMsg").textContent = String(e) === "cancelado" ? "Download cancelado." : String(e); }
  un(); busy = false;
  await refreshStatus();
}
async function create() {
  const min = Math.max(0, Number($("lpMin").value) || 0), max = Math.min(4000, Number($("lpMax").value) || 4000);
  const count = Number($("lpN").value);
  busy = true; $("lpGo").disabled = true; $("lpMsg").textContent = "Procurando puzzles…";
  const cfg = { min: $("lpMin").value, max: $("lpMax").value, n: $("lpN").value, rnd: $("lpRnd").checked, sort: $("lpSort").checked, pop: $("lpPop").checked, all: $("lpAll").value, themes: [...chosen] };
  ls.set("lpCfg", JSON.stringify(cfg));
  try {
    const rows = await invoke("lp_query", { themes: [...chosen], all: $("lpAll").value === "all", min, max, pop: $("lpPop").checked ? 80 : -100, count, random: $("lpRnd").checked, opening: $("lpOpen").value.trim() });
    let list = rows.map(toPuzzle).filter(Boolean);
    if (!list.length) { $("lpMsg").textContent = "Nenhum puzzle com esses filtros. Alargue o rating ou tire temas."; busy = false; $("lpGo").disabled = false; return; }
    if ($("lpSort").checked) list.sort((a, b) => a.rating - b.rating);
    const tn = chosen.size ? [...chosen].slice(0, 3).map((k) => THEMES[k]).join(" + ") + (chosen.size > 3 ? "…" : "") : "Variados";
    await addSet(`Lichess · ${tn} · ${min}–${max}`, list);
    dlg().close();
    toast(`Conjunto criado com ${list.length} puzzles`);
  } catch (e) { $("lpMsg").textContent = String(e) === "cancelado" ? "Cancelado." : String(e); }
  busy = false;
  await refreshStatus();
}
export function initLp(add) {
  addSet = add;
  $("lpBtn").onclick = async () => {
    try { Object.assign(chosen, {}); const c = JSON.parse(ls.get("lpCfg") || "null"); if (c) { $("lpMin").value = c.min; $("lpMax").value = c.max; $("lpN").value = c.n; $("lpRnd").checked = c.rnd; $("lpSort").checked = c.sort; $("lpPop").checked = c.pop; $("lpAll").value = c.all; chosen = new Set(c.themes || []); } } catch {}
    $("lpMsg").textContent = "";
    drawThemes();
    dlg().showModal();
    refreshStatus();
  };
  $("lpThemes").onclick = (e) => { const b = e.target.closest("[data-t]"); if (!b) return; chosen.has(b.dataset.t) ? chosen.delete(b.dataset.t) : chosen.add(b.dataset.t); drawThemes(); };
  $("lpFind").oninput = drawThemes;
  $("lpClear").onclick = () => { chosen.clear(); drawThemes(); };
  $("lpDl").onclick = download;
  $("lpGo").onclick = create;
  $("lpClose").onclick = () => { if (!busy) dlg().close(); };
}
