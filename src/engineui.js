// Interface da engine na Análise: barra de avaliação, linhas do Stockfish, gráfico e análise da partida.
import { Chess } from "./vendor/chess.js";
import { $, esc, ls, toast, ic, askChoice, pickPaths } from "./util.js";
import * as E from "./engine.js";
import { cloudEval } from "./cloud.js";
import { MOVE_NAGS, START_FEN } from "./gametree.js";

const T = window.__TAURI__;
let H = null; // ganchos fornecidos pela tela de análise: cur(), game(), go(node), playLine(pv, k), orient()

// ---------- configurações ----------
const DEF = { lines: 3, threads: Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 2)), hash: 256, depth: 24, moveMs: 300 };
const S = { ...DEF };
try { Object.assign(S, JSON.parse(ls.get("engS") || "{}")); } catch {}
const saveS = () => ls.set("engS", JSON.stringify(S));
let on = ls.get("engOn") === "1";
let cloudOn = ls.get("cloudOn") === "1", cloudSeq = 0, cloudT = null, lastCloud = null;
let paused = false, shown = false, batch = null, posTimer = null, lastLines = null, graphNodes = [], graphW = 600;
const GH = 100; // altura do gráfico

// ---------- avaliação da posição atual ----------
function evalOf(fen) {
  const t = E.terminalEval(new Chess(fen));
  return t || E.cacheGet(fen);
}
function renderBar(e) {
  const bar = $("abEval");
  const w = e ? E.winPct(e) : 50;
  bar.style.setProperty("--w", w.toFixed(1) + "%");
  bar.classList.toggle("flip", H.orient() === "b");
  bar.dataset.lead = w >= 50 ? "w" : "b";
  bar.querySelector(".evl").textContent = e ? E.evalText(e) : "";
}
function renderHead(e, depth, label) {
  $("abEngEval").textContent = e ? E.evalText(e) : "–";
  $("abEngEval").className = "evbig" + (e ? (E.winPct(e) >= 50 ? " w" : " b") : "");
  $("abEngName").textContent = label || E.state.name || "Stockfish";
  $("abEngDepth").textContent = depth ? `profundidade ${depth}` : "";
}

// ---------- nuvem do Lichess ----------
function renderCloud(fen, r) {
  let rows = "";
  for (const k of Object.keys(r.lines)) {
    const l = r.lines[k];
    const e = E.toWhite(fen, l);
    const pv = sanLine(fen, l.pv, 8);
    rows += `<div class="eln" data-k="${k}"><b class="ech ${E.winPct(e) >= 50 ? "w" : "b"}">${E.evalText(e)}</b><span class="pvt">${pv.map((m, i) => `${m.label ? `<i class="pn">${m.label}</i>` : ""}<a data-i="${i}">${esc(m.san)}</a>`).join(" ")}</span></div>`;
  }
  $("abCloudLines").innerHTML = rows;
  $("abCloudInfo").textContent = `prof. ${r.depth}${r.knodes ? " · " + (r.knodes >= 1000 ? Math.round(r.knodes / 1000) + " M nós" : r.knodes + " k nós") : ""}`;
}
const cloudMsg = (t) => { $("abCloudLines").innerHTML = t ? `<div class="emsg">${t}</div>` : ""; $("abCloudInfo").textContent = ""; };
async function requestCloud() {
  if (!shown || !cloudOn || !H || paused) return;
  const fen = H.cur().fen, my = ++cloudSeq;
  if (E.terminalEval(new Chess(fen))) { cloudMsg(""); return; }
  cloudMsg("Consultando a nuvem do Lichess…");
  try {
    const r = await cloudEval(fen, 2);
    if (my !== cloudSeq || !cloudOn) return;
    if (!r) { lastCloud = null; cloudMsg("A nuvem do Lichess não tem esta posição."); return; }
    lastCloud = { fen, lines: r.lines };
    renderCloud(fen, r);
    const e = E.toWhite(fen, r.lines[1]);
    if (r.depth >= 20) { // posição bem analisada: vale como avaliação (barra e gráfico) mesmo com a engine desligada
      E.cachePut(fen, { ...e, depth: Math.min(r.depth, 90) });
      renderGraph();
      if (!(on && lastLines && lastLines.fen === fen)) { renderBar(e); renderHead(e, r.depth, "Nuvem do Lichess"); }
    }
  } catch (err) {
    if (my !== cloudSeq) return;
    const m = String(err?.message || err);
    cloudMsg(m === "rate" ? "O Lichess pediu para esperar um pouco. Tente de novo em instantes." : m === "net" ? "Sem conexão com o Lichess." : "Não consegui consultar a nuvem (" + esc(m) + ").");
  }
}
function scheduleCloud(ms = 450) { clearTimeout(cloudT); cloudT = setTimeout(requestCloud, ms); }

// ---------- avaliações gravadas no PGN ([%eval]) ----------
function parseEvalTag(v) { // "0.17" | "0.17,18" | "#3" | "#-2"
  const [val, d] = v.split(",");
  const depth = Number(d) || 20;
  if (val.startsWith("#")) { const n = Number(val.slice(1)); return Number.isFinite(n) && n !== 0 ? { mate: n, depth } : null; }
  const f = parseFloat(val);
  return Number.isFinite(f) ? { cp: Math.round(f * 100), depth } : null;
}
// partidas que já trazem [%eval] (Lichess, En Croissant...) preenchem o gráfico sem rodar a engine
function hydrate() {
  if (!H) return;
  const nodes = H.game().mainLine();
  let got = 0;
  for (const n of nodes) {
    for (const c of n.cmds) {
      const m = c.match(/^\[%eval\s+([^\]\s]+)\]$/);
      const e = m && parseEvalTag(m[1]);
      if (e) { E.cachePut(n.fen, e); got++; }
    }
  }
  const r = nodes[0];
  if (got > 1 && r.fen === START_FEN && !E.cacheGet(r.fen)) E.cachePut(r.fen, { cp: 20, depth: 20 }); // PGNs do Lichess não trazem a avaliação inicial
}
const evalTag = (e) => `${e.mate != null ? "#" + e.mate : (e.cp / 100).toFixed(2)}${e.depth ? "," + Math.min(99, e.depth) : ""}`;
async function annotateGame() {
  const nodes = H.game().mainLine();
  const ev = nodes.map((n) => evalOf(n.fen));
  if (ev.filter(Boolean).length < 2) { toast("Analise a partida primeiro."); return; }
  const c = await askChoice("Gravar a análise no PGN", "Grava a avaliação de cada lance como [%eval] (formato do Lichess) e, se quiser, marca imprecisões (?!), erros (?) e erros graves (??) nos lances que ainda não têm marca. Dá para desfazer com Desfazer.", ["Avaliações e marcas", "Só avaliações", "Remover avaliações", "Cancelar"]);
  if (c < 0 || c === 3) return;
  let marks = 0, evals = 0;
  H.edit(() => {
    nodes.forEach((n, i) => {
      if (i === 0) return;
      n.cmds = n.cmds.filter((x) => !/^\[%eval\b/.test(x));
      if (c === 2) return;
      const e = ev[i];
      if (!e || e.final) return;
      n.cmds.push(`[%eval ${evalTag(e)}]`);
      evals++;
      if (c === 0 && ev[i - 1]) {
        const l = lossPct(ev[i - 1], e, n.color);
        const nag = l >= 15 ? 4 : l >= 10 ? 2 : l >= 5 ? 6 : 0; // ??  ?  ?!
        if (nag && !n.nags.some((x) => MOVE_NAGS.includes(x))) { n.nags.push(nag); n.nags.sort((a, b) => a - b); marks++; }
      }
    });
  });
  toast(c === 2 ? "Avaliações removidas" : `${evals} avaliações gravadas${c === 0 ? ` · ${marks} marcas` : ""}`);
}

// ---------- linhas (variantes principais) ----------
function sanLine(fen, pv, max = 10) {
  const c = new Chess(fen), out = [];
  const p = fen.split(" ");
  let num = parseInt(p[5], 10) || 1, white = p[1] === "w";
  for (let i = 0; i < pv.length && i < max; i++) {
    const u = pv[i];
    let m;
    try { m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); } catch { break; }
    out.push({ san: m.san, label: white ? `${num}.` : i === 0 ? `${num}…` : "" });
    if (!white) num++;
    white = !white;
  }
  return out;
}
function renderLines(fen, lines) {
  lastLines = { fen, lines };
  let rows = "";
  for (let k = 1; k <= S.lines; k++) {
    const l = lines[k];
    if (!l) continue;
    const e = E.toWhite(fen, l);
    const pv = sanLine(fen, l.pv);
    rows += `<div class="eln" data-k="${k}"><b class="ech ${E.winPct(e) >= 50 ? "w" : "b"}">${E.evalText(e)}</b><span class="pvt">${pv.map((m, i) => `${m.label ? `<i class="pn">${m.label}</i>` : ""}<a data-i="${i}">${esc(m.san)}</a>`).join(" ")}</span></div>`;
  }
  $("abEngLines").innerHTML = rows || `<div class="emsg">Calculando…</div>`;
  const l1 = lines[1];
  if (l1) {
    const e = E.toWhite(fen, l1);
    renderHead(e, l1.depth);
    renderBar(e);
    if (l1.depth >= 10) { E.cachePut(fen, e); renderGraph(); }
  }
}
const setMsg = (html) => { $("abEngLines").innerHTML = `<div class="emsg">${html}</div>`; };

// ---------- análise ao vivo ----------
async function ensureReady() {
  if (E.state.ready) return true;
  try {
    setMsg("Iniciando a engine…");
    await E.ensure({ threads: S.threads, hash: S.hash });
    return true;
  } catch (err) {
    const m = String(err?.message || err);
    if (m === "not-installed") {
      setMsg(`Stockfish não encontrado. <button id="abEngInst">Baixar Stockfish (≈80 MB)</button> <button class="ghost" id="abEngSet">Outras opções…</button>`);
    } else setMsg(esc(m));
    on = false; $("abEngSw").checked = false; ls.set("engOn", "0");
    return false;
  }
}
async function requestLive() {
  if (!shown || !on || batch || paused) return;
  const fen = H.cur().fen;
  const t = E.terminalEval(new Chess(fen));
  if (t) {
    E.stopSearch();
    $("abEngLines").innerHTML = `<div class="emsg">${t.draw ? "Empate." : "Xeque-mate."}</div>`;
    renderHead(t, 0); renderBar(t);
    return;
  }
  if (!(await ensureReady())) return;
  if (!shown || !on || batch || fen !== H.cur().fen) return;
  E.search(fen, {
    multipv: S.lines, depth: S.depth,
    onInfo: (lines) => { if (fen === H.cur().fen && on && !batch) renderLines(fen, lines); },
  });
}
function renderIdle() {
  const fen = H.cur().fen;
  const e = evalOf(fen);
  renderBar(e);
  renderHead(e, e && !e.final ? e.depth : 0);
  lastLines = null;
  if (!on) $("abEngLines").innerHTML = `<div class="emsg">Engine desligada. Use o botão ao lado para ligar.</div>`;
}

// ---------- ganchos chamados pela tela de análise ----------
export function initEngineUI(hooks) {
  H = hooks;
  $("abEngSw").checked = on;
  $("abEngSw").onchange = (e) => {
    on = e.target.checked;
    ls.set("engOn", on ? "1" : "0");
    if (on) { renderIdle(); requestLive(); } else { E.stopSearch(); renderIdle(); }
  };
  $("abEngLines").addEventListener("click", (e) => {
    if (e.target.closest("#abEngInst")) { openSettings(true); return; }
    if (e.target.closest("#abEngSet")) { openSettings(); return; }
    const a = e.target.closest("a[data-i]");
    if (!a || !lastLines || lastLines.fen !== H.cur().fen) return;
    const l = lastLines.lines[a.closest(".eln").dataset.k];
    if (l) H.playLine(l.pv, Number(a.dataset.i));
  });
  $("abEngCfg").onclick = () => openSettings();
  $("abCloudSw").checked = cloudOn;
  $("abCloudSw").onchange = (e) => {
    cloudOn = e.target.checked;
    ls.set("cloudOn", cloudOn ? "1" : "0");
    cloudSeq++;
    if (cloudOn) scheduleCloud(0); else { cloudMsg(""); lastCloud = null; }
  };
  $("abCloudLines").addEventListener("click", (e) => {
    const a = e.target.closest("a[data-i]");
    if (!a || !lastCloud || lastCloud.fen !== H.cur().fen) return;
    const l = lastCloud.lines[a.closest(".eln").dataset.k];
    if (l) H.playLine(l.pv, Number(a.dataset.i));
  });
  $("abAnnot").onclick = annotateGame;
  $("abAnalyze").onclick = analyzeGame;
  // gráfico: clicar/arrastar navega pela partida
  const box = $("abGraphBox");
  let down = false;
  const seek = (ev) => {
    const n = graphNodes.length;
    if (n < 2) return;
    const r = box.getBoundingClientRect();
    const i = Math.round(((ev.clientX - r.left - 6) / (r.width - 12)) * (n - 1));
    const node = graphNodes[Math.max(0, Math.min(n - 1, i))];
    if (node) H.go(node);
  };
  box.addEventListener("pointerdown", (ev) => { down = true; seek(ev); });
  window.addEventListener("pointermove", (ev) => { if (down) seek(ev); });
  window.addEventListener("pointerup", () => { down = false; });
  window.addEventListener("resize", () => { if (shown) renderGraph(); });
}
export function onPosition() {
  if (!H || !shown) return;
  const fen = H.cur().fen;
  const e = evalOf(fen);
  if (!(on && lastLines && lastLines.fen === fen)) { renderBar(e); renderHead(e, e && !e.final ? e.depth : 0); }
  if (paused) $("abEngLines").innerHTML = `<div class="emsg">Análise pausada durante a partida.</div>`;
  else if (on && !batch && !(lastLines && lastLines.fen === fen)) $("abEngLines").innerHTML = `<div class="emsg">Calculando…</div>`;
  renderGraph();
  clearTimeout(posTimer);
  posTimer = setTimeout(requestLive, 150);
  if (cloudOn && !paused) { lastCloud = null; scheduleCloud(); }
}
// Pausa a análise ao vivo (a tela de jogo usa a engine). Ao retomar, volta a analisar.
export function pause(v) {
  paused = !!v;
  if (paused) { E.stopSearch(); cloudSeq++; clearTimeout(cloudT); clearTimeout(posTimer); lastLines = null; if (shown) $("abEngLines").innerHTML = `<div class="emsg">Análise pausada durante a partida.</div>`; }
  else if (shown) { renderIdle(); requestLive(); if (cloudOn) scheduleCloud(300); }
}
export function onGameChanged() {
  if (!H) return;
  cancelBatch(false);
  lastLines = null;
  $("abSummary").innerHTML = "";
  hydrate();
  if (shown) { onPosition(); renderSummary(); }
}
export async function onShow() {
  shown = true;
  if (ls.get("engOn") === null) { // primeira vez: liga sozinha se já houver engine
    try { const st = await E.status(); if (st.active) { on = true; ls.set("engOn", "1"); $("abEngSw").checked = true; } } catch {}
  }
  $("abEngSw").checked = on;
  hydrate();
  renderIdle();
  renderGraph();
  renderSummary();
  requestLive();
  if (cloudOn) scheduleCloud(300);
}
export function onHide() {
  shown = false;
  cloudSeq++; clearTimeout(cloudT);
  cancelBatch(false);
  clearTimeout(posTimer);
  E.cacheSave();
  E.quit();
  lastLines = null;
}
export function onFlip() { if (H) renderBar(evalOf(H.cur().fen)); }

// ---------- análise da partida inteira ----------
function cancelBatch(restart = true) {
  if (!batch) return;
  batch = null;
  E.stopSearch();
  $("abAnalyze").innerHTML = `${ic("play")}Analisar partida`;
  $("abGraphInfo").textContent = "";
  if (restart) requestLive();
}
async function analyzeGame() {
  if (batch) { cancelBatch(); return; }
  const nodes = H.game().mainLine();
  if (nodes.length < 2) { toast("Jogue ou abra uma partida primeiro."); return; }
  const token = {};
  batch = token;
  E.stopSearch();
  $("abAnalyze").innerHTML = `${ic("stop")}Parar`;
  $("abGraphInfo").textContent = "Iniciando…";
  const wasOn = on;
  if (!(await ensureReady())) { batch = null; $("abAnalyze").innerHTML = `${ic("play")}Analisar partida`; $("abGraphInfo").textContent = ""; return; }
  if (batch !== token) return;
  for (let i = 0; i < nodes.length; i++) {
    if (batch !== token) return;
    const fen = nodes[i].fen;
    const t = E.terminalEval(new Chess(fen));
    if (t) { E.cachePut(fen, t); continue; }
    const have = E.cacheGet(fen);
    if (have && have.depth >= 12) { $("abGraphInfo").textContent = `${i + 1}/${nodes.length}`; continue; }
    const lines = await E.searchOnce(fen, { multipv: 1, movetime: S.moveMs });
    if (batch !== token) return;
    if (lines && lines[1]) E.cachePut(fen, E.toWhite(fen, lines[1]));
    $("abGraphInfo").textContent = `${i + 1}/${nodes.length}`;
    renderGraph();
    if (i % 8 === 7) H.moves?.();
    if (shown && H.cur() === nodes[i]) renderBar(evalOf(fen));
  }
  batch = null;
  E.cacheSave();
  $("abAnalyze").innerHTML = `${ic("play")}Analisar partida`;
  $("abGraphInfo").textContent = "Análise concluída";
  renderGraph(); renderSummary(); onPosition(); H.moves?.();
  if (!wasOn) { /* engine pode continuar desligada: só o gráfico foi preenchido */ }
}

// ---------- gráfico ----------
const MIS = { inac: ["#56b4e9", 5], mist: ["#e69d00", 10], blun: ["#df5353", 15] };
function lossPct(a, b, mover) {
  const w0 = E.winPct(a), w1 = E.winPct(b);
  return mover === "w" ? w0 - w1 : w1 - w0;
}
// Classificação de um lance pela perda de chance de vitória (só se a posição antes e depois já foi avaliada)
const CLS = { inac: ["Imprecisão", "#56b4e9"], mist: ["Erro", "#e69d00"], blun: ["Erro grave", "#df5353"] };
export function moveClass(node) {
  if (!node.parent) return null;
  const a = E.cacheGet(node.parent.fen), b = E.cacheGet(node.fen);
  if (!a || !b) return null;
  const l = lossPct(a, b, node.color);
  const k = l >= 15 ? "blun" : l >= 10 ? "mist" : l >= 5 ? "inac" : null;
  return k ? { k, loss: Math.round(l), label: CLS[k][0] } : null;
}
function renderGraph() {
  const box = $("abGraphBox");
  if (!box) return;
  const W = Math.max(240, Math.floor(box.clientWidth || 600));
  graphW = W;
  const nodes = H.game().mainLine();
  graphNodes = nodes;
  const N = nodes.length;
  const ev = nodes.map((n) => evalOf(n.fen));
  const x = (i) => (N > 1 ? 6 + ((W - 12) * i) / (N - 1) : W / 2);
  const y = (p) => 4 + (GH - 8) * (1 - p / 100);
  let s = `<rect class="gbg" width="${W}" height="${GH}"/>`;
  const pts = [];
  ev.forEach((e, i) => { if (e) pts.push([x(i), y(E.winPct(e))]); });
  $("abAnnot").hidden = pts.length < 2;
  if (pts.length >= 2) {
    const line = pts.map((p, k) => `${k ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    s += `<path class="garea" d="M${pts[0][0].toFixed(1)},${GH} L${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L")} L${pts[pts.length - 1][0].toFixed(1)},${GH} Z"/>`;
    s += `<line class="gmid" x1="0" x2="${W}" y1="${y(50)}" y2="${y(50)}"/>`;
    s += `<path class="gline" d="${line}"/>`;
    for (let i = 1; i < N; i++) {
      if (!ev[i] || !ev[i - 1]) continue;
      const l = lossPct(ev[i - 1], ev[i], nodes[i].color);
      const k = l >= 15 ? "blun" : l >= 10 ? "mist" : l >= 5 ? "inac" : null;
      if (k) s += `<circle cx="${x(i).toFixed(1)}" cy="${y(E.winPct(ev[i])).toFixed(1)}" r="3.2" fill="${MIS[k][0]}"/>`;
    }
  } else {
    s += `<line class="gmid" x1="0" x2="${W}" y1="${y(50)}" y2="${y(50)}"/>`;
    s += `<text class="ghint" x="${W / 2}" y="${GH / 2 - 4}" text-anchor="middle">${N < 2 ? "Jogue ou abra uma partida" : "Clique em “Analisar partida” para ver o gráfico"}</text>`;
  }
  // marcador da posição atual (se estiver numa variação, mostra o ponto de saída)
  const main = new Set(nodes);
  let c = H.cur();
  while (c && !main.has(c)) c = c.parent;
  const ci = c ? nodes.indexOf(c) : 0;
  s += `<line class="gcur" x1="${x(ci).toFixed(1)}" x2="${x(ci).toFixed(1)}" y1="0" y2="${GH}"/>`;
  $("abGraphSvg").setAttribute("viewBox", `0 0 ${W} ${GH}`);
  $("abGraphSvg").innerHTML = s;
}
// Precisão (método do Lichess): cada lance recebe uma nota pela perda de chance de vitória; a média
// final mistura a média ponderada pela "volatilidade" da partida com a média harmônica.
export function moveAccuracy(winBefore, winAfter) {
  const loss = Math.max(0, winBefore - winAfter);
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669 + 1));
}
export function accuracyOf(wins) { // wins: chance de vitória das brancas (0-100) em cada posição da linha principal
  const N = wins.length;
  if (N < 3) return { w: null, b: null };
  const win = Math.max(2, Math.min(8, Math.floor((N - 1) / 10)));
  const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
  const acc = { w: [], b: [] };
  for (let i = 1; i < N; i++) {
    const mover = i % 2 === 1 ? "w" : "b";
    const w0 = mover === "w" ? wins[i - 1] : 100 - wins[i - 1];
    const w1 = mover === "w" ? wins[i] : 100 - wins[i];
    const weight = Math.max(0.5, Math.min(12, sd(wins.slice(Math.max(0, i - win), Math.min(N, i + win)))));
    acc[mover].push([moveAccuracy(w0, w1), weight]);
  }
  const fin = (list) => {
    if (!list.length) return null;
    const sw = list.reduce((x, [, w]) => x + w, 0);
    const weighted = list.reduce((x, [a, w]) => x + a * w, 0) / sw;
    const harmonic = list.length / list.reduce((x, [a]) => x + 1 / Math.max(a, 0.01), 0);
    return (weighted + harmonic) / 2;
  };
  return { w: fin(acc.w), b: fin(acc.b) };
}
function renderSummary() {
  const nodes = H.game().mainLine();
  const ev = nodes.map((n) => evalOf(n.fen));
  const st = { w: { inac: 0, mist: 0, blun: 0, loss: 0, n: 0 }, b: { inac: 0, mist: 0, blun: 0, loss: 0, n: 0 } };
  let pairs = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (!ev[i] || !ev[i - 1]) continue;
    pairs++;
    const m = nodes[i].color, o = st[m];
    const l = lossPct(ev[i - 1], ev[i], m);
    if (l >= 15) o.blun++; else if (l >= 10) o.mist++; else if (l >= 5) o.inac++;
    const c0 = E.cpOf(ev[i - 1]), c1 = E.cpOf(ev[i]);
    o.loss += Math.max(0, m === "w" ? c0 - c1 : c1 - c0);
    o.n++;
  }
  if (pairs < 2) { $("abSummary").innerHTML = ""; return; }
  // a precisão só vale se a partida toda foi analisada
  const full = ev.every(Boolean);
  const acc = full ? accuracyOf(ev.map((e) => E.winPct(e))) : { w: null, b: null };
  const fmt = (a) => (a == null ? "—" : a.toFixed(1).replace(".", ",") + "%");
  const row = (nm, o, a, cls) => `<div class="srow"><b>${nm}</b><span class="acc ${cls}" title="Precisão (método do Lichess)">${fmt(a)}</span><span style="color:${MIS.inac[0]}">${o.inac} imprecis${o.inac === 1 ? "ão" : "ões"}</span><span style="color:${MIS.mist[0]}">${o.mist} erro${o.mist === 1 ? "" : "s"}</span><span style="color:${MIS.blun[0]}">${o.blun} erro${o.blun === 1 ? "" : "s"} grave${o.blun === 1 ? "" : "s"}</span><small>perda média ${o.n ? Math.round(o.loss / o.n) : 0}</small></div>`;
  $("abSummary").innerHTML = (full ? "" : `<div class="srow"><small style="margin:0">Analise a partida inteira para ver a precisão.</small></div>`) + row("Brancas", st.w, acc.w, "w") + row("Pretas", st.b, acc.b, "b");
}

// ---------- configurações da engine ----------
async function openSettings(autoInstall = false) {
  const d = document.createElement("dialog");
  d.id = "engDlg";
  const opts = (arr, cur) => arr.map(([v, l]) => `<option value="${v}" ${String(cur) === String(v) ? "selected" : ""}>${l}</option>`).join("");
  d.innerHTML = `<b>Engine</b>
    <div class="engst" id="eSt">Verificando…</div>
    <div class="row"><button id="eI">${ic("download")}Baixar / atualizar Stockfish</button><button class="ghost" id="eP">Escolher outro programa…</button><button class="ghost" id="eD">Usar o padrão</button></div>
    <div class="engmsg" id="eMsg"></div>
    <div class="grid2">
      <label>Linhas de variantes<select id="sL">${opts([1, 2, 3, 4, 5].map((n) => [n, n]), S.lines)}</select></label>
      <label>Threads (núcleos)<input type="number" id="sT" min="1" max="64" value="${S.threads}"></label>
      <label>Memória (hash)<select id="sH">${opts([[64, "64 MB"], [128, "128 MB"], [256, "256 MB"], [512, "512 MB"], [1024, "1 GB"], [2048, "2 GB"]], S.hash)}</select></label>
      <label>Profundidade máxima<select id="sD">${opts([[16, "16"], [20, "20"], [24, "24"], [30, "30"], [40, "40"], [99, "Sem limite"]], S.depth)}</select></label>
      <label>Tempo por lance (analisar partida)<select id="sM">${opts([[100, "0,1 s"], [200, "0,2 s"], [300, "0,3 s"], [500, "0,5 s"], [1000, "1 s"], [2000, "2 s"]], S.moveMs)}</select></label>
    </div>
    <div class="row"><button id="eOk">Salvar</button><button class="ghost" id="eNo">Fechar</button></div>`;
  document.body.appendChild(d);
  const q = (id) => d.querySelector("#" + id);
  const refresh = async () => {
    const st = await E.status();
    const how = st.configured ? "escolhido por você" : st.managed ? "baixado pelo app" : "instalado no sistema";
    q("eSt").innerHTML = st.active ? `Em uso: <code>${esc(st.active)}</code><br><small>${how}${E.state.name ? " · " + esc(E.state.name) : ""}</small>` : `Nenhuma engine encontrada. Baixe o Stockfish ou escolha um programa UCI.`;
  };
  const install = async () => {
    q("eI").disabled = true;
    try {
      await E.quit();
      const p = await E.install((m) => { q("eMsg").textContent = m; });
      q("eMsg").textContent = "Pronto! Stockfish instalado.";
      toast("Stockfish instalado");
      lastLines = null;
    } catch (e) { q("eMsg").textContent = String(e); }
    q("eI").disabled = false;
    await refresh();
  };
  d.addEventListener("click", async (e) => {
    if (e.target.closest("#eI")) install();
    else if (e.target.closest("#eP")) {
      const p = await pickPaths({ multiple: false, extensions: ["*"], name: "Programa UCI" });
      if (p) {
        await E.setEnginePath(Array.isArray(p) ? p[0] : p); await E.quit();
        q("eMsg").textContent = "Testando o programa…";
        try {
          await E.ensure({ threads: S.threads, hash: S.hash });
          q("eMsg").textContent = `Pronto: ${E.state.name || "programa UCI"} respondeu. ${E.eloRange() ? "Aceita limite de força (Elo)." : "Não tem limite de força: na partida contra o motor ele joga no máximo."}`;
        } catch { q("eMsg").textContent = "Esse programa não respondeu como uma engine UCI. Voltando ao padrão."; await E.setEnginePath(null); await E.quit(); }
        await refresh();
      }
    } else if (e.target.closest("#eD")) { await E.setEnginePath(null); await E.quit(); q("eMsg").textContent = "Voltou ao padrão."; await refresh(); }
    else if (e.target.closest("#eOk")) {
      const old = { ...S };
      S.lines = Number(q("sL").value); S.threads = Math.max(1, Math.min(64, Number(q("sT").value) || 1));
      S.hash = Number(q("sH").value); S.depth = Number(q("sD").value); S.moveMs = Number(q("sM").value);
      saveS();
      if (old.threads !== S.threads || old.hash !== S.hash) await E.quit();
      d.close();
    } else if (e.target.closest("#eNo")) d.close();
  });
  d.addEventListener("close", () => { d.remove(); lastLines = null; if (on) requestLive(); });
  d.showModal();
  await refresh();
  if (autoInstall) install();
}
