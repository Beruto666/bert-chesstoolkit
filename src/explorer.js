// Explorador de database na Análise: escolha uma database; ao mover as peças aparecem os lances mais jogados
// (com resultados) e as melhores partidas daquela posição.
import { $, esc, ls, toast, askForm } from "./util.js";
import { START_FEN } from "./gametree.js";

const T = window.__TAURI__;
const invoke = (c, a) => T.core.invoke(c, a);
let H = null, dbs = [], timer = null, seq = 0, lastKey = "", sugT = null, sugSeq = 0;
let player = (ls.get("exPlayer") || "").trim(), side = ["w", "b"].includes(ls.get("exSide")) ? ls.get("exSide") : "";
const fmtN = (n) => n.toLocaleString("pt-BR");

export function init(hooks) { H = hooks; } // { cur, game, playSan(san), openGame(id, index, name) }

export async function loadDbs() {
  try { dbs = (await invoke("db_list")) || []; } catch { dbs = []; }
  const sel = $("exDb");
  const want = ls.get("exDb") || "";
  sel.innerHTML = `<option value="">Nenhuma database</option><optgroup label="Online (Lichess)"><option value="@masters">Mestres (Lichess)</option><option value="@lichess">Jogadores do Lichess</option><option value="@player">Jogador no Lichess</option></optgroup>` + dbs.map((d) => `<option value="${d.id}">${esc(d.name)} (${fmtN(d.games)})</option>`).join("");
  sel.value = isOnline(want) || dbs.some((d) => d.id === want) ? want : "";
  if (sel.value !== want) ls.set("exDb", sel.value);
  syncOnlineUi();
}
$("exDb").onchange = (e) => { ls.set("exDb", e.target.value); lastKey = ""; syncOnlineUi(); update(true); };
$("exManage").onclick = () => document.dispatchEvent(new CustomEvent("goto-db"));

export function selected() { return $("exDb").value; }
const isOnline = (v) => v === "@masters" || v === "@lichess" || v === "@player";

// ---- explorador online do Lichess (mestres / jogadores / um jogador) ----
const SPEEDS = { "": "", fast: "bullet,blitz", slow: "rapid,classical", classical: "classical" };
const RATES = { "": "", hi: "2000,2200,2500", mid: "1600,1800", lo: "1000,1200,1400" };
const cache = new Map();
let speed = ls.get("exSpeed") in SPEEDS ? ls.get("exSpeed") : "", rate = ls.get("exRate") in RATES ? ls.get("exRate") : "";
function syncOnlineUi() {
  const v = selected(), on = isOnline(v);
  $("exOnline").style.display = on ? "flex" : "none";
  $("exSpeed").style.display = $("exRate").style.display = v === "@lichess" ? "" : "none";
  $("exSpeed").value = speed; $("exRate").value = rate;
  $("exPlayer").placeholder = v === "@player" ? "Usuário no Lichess (obrigatório)" : "Filtrar por jogador (opcional)";
  $("exFilter").style.display = on && v !== "@player" ? "none" : "";
  $("exPlayer").setAttribute("list", on ? "" : "exPlayers");
}
$("exSpeed").onchange = (e) => { speed = e.target.value; ls.set("exSpeed", speed); lastKey = ""; update(true); };
$("exRate").onchange = (e) => { rate = e.target.value; ls.set("exRate", rate); lastKey = ""; update(true); };
export async function askToken() {
  const r = await askForm("Token do Lichess", [{ key: "t", label: "Cole o token pessoal (crie em lichess.org/account/oauth/token, sem marcar nenhuma permissão). Deixe vazio para remover.", value: ls.get("lichessToken") || "" }], "Salvar");
  if (!r) return;
  const t = (r.t || "").trim();
  if (t && !/^[A-Za-z0-9_-]{8,100}$/.test(t)) { toast("Token inválido."); return; }
  ls.set("lichessToken", t); cache.clear(); lastKey = ""; toast(t ? "Token salvo." : "Token removido."); update(true);
}
$("exToken").onclick = askToken;
const tokenHint = () => `<div class="hint">O Lichess agora exige um token para usar o explorador online. É grátis e leva um minuto: crie um em <b>lichess.org/account/oauth/token</b> (sem marcar nenhuma permissão) e cole aqui.<br><br><button class="ghost" id="exTokBtn">Colar token</button></div>`;
async function getJson(url, long) {
  if (cache.has(url)) return cache.get(url);
  const r = await invoke("http_get", { url, token: ls.get("lichessToken") || null, timeout: long ? 60 : 20 });
  if (r.status === 401 || r.status === 403) throw new Error("401");
  if (r.status === 429) throw new Error("O Lichess limitou os pedidos. Espere um minuto e tente de novo.");
  if (r.status !== 200) throw new Error(r.status ? `O Lichess respondeu com erro ${r.status}.` : "Sem conexão com o Lichess.");
  // o explorador de jogador manda NDJSON enquanto indexa: vale a última linha
  const lines = r.body.trim().split("\n").filter((l) => l.trim());
  const j = JSON.parse(lines[lines.length - 1] || "{}");
  if (cache.size > 200) cache.clear();
  cache.set(url, j);
  return j;
}
function onlineUrl(v, fen) {
  const base = "https://explorer.lichess.ovh/", q = `fen=${encodeURIComponent(fen)}&moves=12`;
  if (v === "@masters") return `${base}masters?${q}&topGames=8`;
  if (v === "@lichess") return `${base}lichess?variant=standard&${q}&topGames=8` + (SPEEDS[speed] ? `&speeds=${SPEEDS[speed]}` : "") + (RATES[rate] ? `&ratings=${RATES[rate]}` : "");
  return `${base}player?player=${encodeURIComponent(player)}&color=${side === "b" ? "black" : "white"}&${q}&recentGames=8`;
}
function fromOnline(j, v) {
  const tot = (x) => x.white + x.draws + x.black;
  const moves = (j.moves || []).map((m) => ({ san: m.san, n: tot(m), w: m.white, d: m.draws, b: m.black, elo: m.averageRating || 0 })).filter((m) => m.n);
  const games = (j.topGames || j.recentGames || []).map((x) => ({
    gid: x.id, white: x.white.name, welo: x.white.rating, black: x.black.name, belo: x.black.rating,
    result: x.winner === "white" ? "1-0" : x.winner === "black" ? "0-1" : "1/2-1/2", year: x.year || (x.month ? x.month.slice(0, 4) : ""), masters: v === "@masters",
  }));
  return { ready: true, by_pos: true, total: tot(j), moves, games };
}
async function openOnlineGame(id, masters) {
  const url = masters ? `https://explorer.lichess.ovh/masters/pgn/${id}` : `https://lichess.org/game/export/${id}?clocks=false&evals=false`;
  const r = await invoke("http_get", { url, token: ls.get("lichessToken") || null, accept: "pgn" });
  if (r.status !== 200 || !r.body.trim()) throw new Error("Não consegui baixar essa partida.");
  await H.openText(r.body, masters ? "Mestres (Lichess)" : "Lichess");
}

// ---- filtro de jogador / cor ----
const getSide = () => side; // o render() tem uma variável local "side" própria
const sideText = () => (side === "w" ? " de brancas" : side === "b" ? " de pretas" : "");
const filterText = () => (player ? ` de “${player}”${sideText()}` : "");
function syncFilterUi() {
  $("exPlayer").value = player;
  for (const b of $("exSide").querySelectorAll("button")) b.classList.toggle("on", b.dataset.s === side);
  $("exClear").style.visibility = player ? "visible" : "hidden";
}
const filterNote = () => (side && !player ? `<div class="exnote">Digite um jogador para usar o filtro de cor.</div>` : "");
async function suggest(q) {
  const id = selected(), my = ++sugSeq;
  if (!id || isOnline(id) || q.trim().length < 2) { $("exPlayers").innerHTML = ""; return; }
  try {
    const list = await invoke("db_players", { id, query: q, limit: 12 });
    if (my !== sugSeq) return;
    $("exPlayers").innerHTML = list.map((p) => `<option value="${esc(p.name)}">${esc(p.name)} (${fmtN(p.n)})</option>`).join("");
  } catch { /* sem sugestões */ }
}
function setPlayer(v, now = false) {
  player = v.trim();
  ls.set("exPlayer", player);
  syncFilterUi();
  lastKey = "";
  update(now);
}
$("exPlayer").oninput = (e) => {
  player = e.target.value.trim();
  ls.set("exPlayer", player);
  $("exClear").style.visibility = player ? "visible" : "hidden";
  clearTimeout(sugT);
  sugT = setTimeout(() => suggest(e.target.value), 350);
  lastKey = "";
  update(); // espera a pessoa terminar de digitar
};
$("exPlayer").onchange = (e) => setPlayer(e.target.value, true); // escolheu uma sugestão ou saiu do campo
$("exPlayer").onkeydown = (e) => { if (e.key === "Enter") setPlayer(e.target.value, true); };
$("exSide").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  side = b.dataset.s;
  ls.set("exSide", side);
  syncFilterUi();
  lastKey = "";
  update(true);
};
$("exClear").onclick = () => { $("exPlayers").innerHTML = ""; setPlayer("", true); };
syncFilterUi();

export function update(now = false) {
  clearTimeout(timer);
  timer = setTimeout(run, now ? 0 : 180);
}
async function run() {
  if (!H) return;
  const box = $("exBody");
  const id = selected();
  if (!id) { box.innerHTML = `<div class="hint">Escolha uma database acima para ver os lances e partidas desta posição.${dbs.length ? "" : " Você ainda não importou nenhuma: use “Gerenciar”."}</div>`; return; }
  const g = H.game(), c = H.cur();
  if (isOnline(id)) return runOnline(id, c, box);
  if (g.fen0 !== START_FEN) { box.innerHTML = `<div class="hint">O explorador só funciona em partidas que começam da posição inicial.</div>`; return; }
  const sans = g.line(c).slice(1).map((n) => n.san);
  const key = id + "|" + player.toLowerCase() + "|" + (player ? side : "") + "|" + sans.join(" ");
  if (key === lastKey) return;
  lastKey = key;
  const my = ++seq;
  box.innerHTML = `<div class="hint">Buscando…</div>`;
  let r;
  try { r = await invoke("db_explore", { id, moves: sans, player, side: player ? side : "" }); } catch (e) { if (my === seq) box.innerHTML = `<div class="hint">${esc(String(e))}</div>`; return; }
  if (my !== seq) return; // chegou resposta velha
  render(r, sans);
}
async function runOnline(v, c, box) {
  if (v === "@player" && !player) { box.innerHTML = `<div class="hint">Digite o usuário do Lichess acima e escolha Brancas ou Pretas.</div>`; return; }
  if (v === "@player" && !side) { box.innerHTML = `<div class="hint">Escolha Brancas ou Pretas: o explorador de jogador mostra uma cor por vez.</div>`; return; }
  const url = onlineUrl(v, c.fen), key = "O" + url + (ls.get("lichessToken") ? "t" : "");
  if (key === lastKey) return;
  lastKey = key;
  const my = ++seq;
  box.innerHTML = `<div class="hint">Buscando no Lichess…${v === "@player" ? " (na primeira vez o Lichess indexa as partidas e pode demorar)" : ""}</div>`;
  let r;
  try { r = fromOnline(await getJson(url, v === "@player"), v); } catch (e) {
    if (my !== seq) return;
    lastKey = "";
    box.innerHTML = String(e.message) === "401" ? tokenHint() : `<div class="hint">${esc(String(e.message || e))}</div>`;
    return;
  }
  if (my !== seq) return;
  render(r, g_sans(c), v);
}
const g_sans = (c) => H.game().line(c).slice(1).map((n) => n.san);
function render(r, sans, online = "") {
  const box = $("exBody");
  if (!r.ready) { box.innerHTML = `<div class="hint">Esta database foi importada numa versão antiga e não tem índice de lances. Remova-a e importe de novo em “Gerenciar”.</div>`; return; }
  if (r.beyond) { box.innerHTML = `<div class="hint">O índice guarda só os primeiros 30 lances (15 lances de cada lado). Esta linha passou disso.</div>`; return; }
  const oldIdx = r.by_pos ? "" : `<div class="exnote">Esta database usa o índice antigo (compara a sequência de lances, sem somar transposições). Remova e importe de novo em “Gerenciar” para ganhar o modo por posição.</div>`;
  if (!r.total) { box.innerHTML = filterNote() + `<div class="hint">Nenhuma partida${filterText()} chegou a essa posição${!r.by_pos && sans.length ? " por essa sequência de lances" : ""}.</div>` + oldIdx; return; }
  // com jogador e cor escolhidos, as barras ficam do ponto de vista dele: verde = vitória dele, vermelho = derrota
  const fSide = getSide();
  const pov = !!(player && fSide) && online !== "@lichess" && online !== "@masters";
  const bar = (m) => {
    const win = pov && fSide === "b" ? m.b : m.w, loss = pov && fSide === "b" ? m.w : m.b;
    const t = win + m.d + loss || 1, pw = (win / t) * 100, pd = (m.d / t) * 100, pb = 100 - pw - pd;
    const lab = (p) => (p >= 12 ? Math.round(p) + "%" : "");
    return `<div class="exbar${pov ? " pov" : ""}"><i class="w" style="width:${pw}%">${lab(pw)}</i><i class="d" style="width:${pd}%">${lab(pd)}</i><i class="b" style="width:${pb}%">${lab(pb)}</i></div>`;
  };
  const side = sans.length % 2 === 0 ? "" : "…";
  let h = filterNote() + oldIdx + (pov ? `<div class="exnote">Barras do ponto de vista de “${esc(player)}”: verde = vitória dele, vermelho = derrota.</div>` : "") + `<div class="extot">${fmtN(r.total)} ${r.total === 1 ? "partida" : "partidas"}${online === "@player" ? ` de “${esc(player)}”${sideText()}` : online ? "" : filterText()}</div><table class="extab"><tbody>`;
  for (const m of r.moves) {
    h += `<tr class="exmv" data-san="${esc(m.san)}"><td class="sn">${side}${esc(m.san)}</td><td class="nn">${fmtN(m.n)} <small>${((m.n / r.total) * 100).toFixed(m.n / r.total < 0.1 ? 1 : 0)}%</small></td><td class="bb">${bar(m)}</td><td class="el">${m.elo || ""}</td></tr>`;
  }
  h += `</tbody></table>`;
  if (r.games.length) {
    h += `<div class="extit">Melhores partidas</div>` + r.games.map((x) =>
      `<button class="dbrow exg" ${x.gid ? `data-g="${x.gid}" data-m="${x.masters ? 1 : 0}"` : `data-i="${x.i}"`}><span class="n">${x.gid ? "•" : fmtN(x.i + 1)}</span><span class="pl"><b>${esc(x.white)}</b>${x.welo ? ` <small>${x.welo}</small>` : ""}</span><span class="rs">${esc(x.result.replace("1/2-1/2", "½-½"))}</span><span class="pl"><b>${esc(x.black)}</b>${x.belo ? ` <small>${x.belo}</small>` : ""}</span><span class="yr">${x.year || ""}</span></button>`).join("");
  }
  box.innerHTML = h;
}
$("exBody").addEventListener("click", async (e) => {
  if (e.target.closest("#exTokBtn")) { askToken(); return; }
  const m = e.target.closest(".exmv");
  if (m) { H.playSan(m.dataset.san); return; }
  const g = e.target.closest(".exg");
  if (g) {
    try {
      if (g.dataset.g) { await openOnlineGame(g.dataset.g, g.dataset.m === "1"); return; }
      const text = await invoke("db_game", { id: selected(), index: Number(g.dataset.i) });
      const d = dbs.find((v) => v.id === selected());
      await H.openText(text, d ? d.name : "");
    } catch (err) { toast(String(err)); }
  }
});
