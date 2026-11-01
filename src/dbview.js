// Databases PGN grandes: importar (indexado no Rust), buscar por jogador/resultado/ano e abrir partidas na Análise.
import { $, esc, toast, askChoice, pickPaths } from "./util.js";
import { setWatcher } from "./profiles.js";
import { openEditor } from "./editor.js";
import { openReport } from "./report.js";

const T = window.__TAURI__;
const invoke = (c, a) => T.core.invoke(c, a);
const PAGE = 50;
let openGame = null, dbs = [], curDb = null, offset = 0, busy = false, lastQ = null;
export const setOpen = (fn) => { openGame = fn; };

const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : (b / 1e6).toFixed(0) + " MB");
const fmtN = (n) => n.toLocaleString("pt-BR");

export async function refresh() {
  try { dbs = await invoke("db_list"); } catch (e) { dbs = []; }
  renderList();
  const el = $("homeDb");
  if (el) el.textContent = dbs.length ? `${dbs.length} ${dbs.length === 1 ? "database" : "databases"}` : "Importe e busque em PGNs enormes";
}
function renderList() {
  $("dbList").innerHTML = dbs.length
    ? dbs.map((d) => `<div class="dbitem ${curDb === d.id ? "on" : ""}" data-id="${d.id}"><div><b>${esc(d.name)}</b><small>${fmtN(d.games)} partidas · ${fmtSize(d.size)}</small></div><div><button class="ghost" data-open="${d.id}">${curDb === d.id ? "Fechar" : "Abrir"}</button><button class="ghost" data-del="${d.id}" title="Remove só o índice; o PGN original não é apagado">Remover</button></div></div>`).join("")
    : `<p class="muted">Nenhuma database ainda.</p>`;
}
$("dbList").addEventListener("click", async (e) => {
  const o = e.target.closest("[data-open]"), x = e.target.closest("[data-del]");
  if (o) {
    if (curDb === o.dataset.open) { curDb = null; $("dbBrowse").hidden = true; renderList(); return; } // o botão também fecha
    curDb = o.dataset.open; renderList(); startBrowse();
    $("dbBrowse").scrollIntoView({ block: "start", behavior: "smooth" });
  }
  if (x) {
    const d = dbs.find((v) => v.id === x.dataset.del);
    if ((await askChoice("Remover database", `Remover o índice de “${d?.name}”? O arquivo PGN original não é apagado.`, ["Remover", "Cancelar"])) !== 0) return;
    try { await invoke("db_delete", { id: x.dataset.del }); } catch (err) { toast(String(err)); }
    if (curDb === x.dataset.del) { curDb = null; $("dbBrowse").hidden = true; }
    refresh();
  }
});

// ---- importação ----
let un = [];
async function watch(onDone) {
  $("dbProg").hidden = false; $("dbCancel").hidden = false; $("dbImport").disabled = true; $("dbFetch").disabled = true;
  $("dbBar").style.width = "0%"; $("dbProgTx").textContent = "Iniciando…";
  const reset = () => { un.forEach((f) => f()); un = []; $("dbProg").hidden = true; $("dbCancel").hidden = true; $("dbImport").disabled = false; $("dbFetch").disabled = false; };
  un.push(await T.event.listen("db-progress", (ev) => {
    const { done, total, games, phase } = ev.payload;
    $("dbBar").style.width = (total ? (done / total) * 100 : 0).toFixed(1) + "%";
    $("dbProgTx").textContent = (phase ? phase + " " : "") + (games ? `${fmtN(games)} partidas · ` : "") + (total && !phase ? `${fmtSize(done)} de ${fmtSize(total)}` : !total ? fmtSize(done) : "");
  }));
  un.push(await T.event.listen("db-done", (ev) => {
    reset();
    if (onDone) onDone(ev.payload);
    if (ev.payload.ok) toast(`${fmtN(ev.payload.games)} partidas importadas`);
    else if (ev.payload.error !== "cancelado") toast("Falha na importação: " + ev.payload.error);
    refresh();
  }));
  return reset;
}
$("dbImport").onclick = async () => {
  let path;
  path = await pickPaths({ multiple: false });
  if (!path) return;
  const p = Array.isArray(path) ? path[0] : path;
  const name = String(p).split(/[\\/]/).pop().replace(/\.pgn$/i, "");
  const reset = await watch();
  try { await invoke("db_import", { path: p, name }); } catch (e) { toast(String(e)); reset(); }
};
$("dbFetch").onclick = async () => {
  const user = $("dbUser").value.trim();
  if (!user) { toast("Digite o usuário."); return; }
  const reset = await watch();
  try { await invoke("db_online", { site: $("dbSite").value, user, max: Number($("dbMax").value) || 0 }); } catch (e) { toast(String(e)); reset(); }
};
$("dbCancel").onclick = () => invoke("db_cancel");

// ---- busca ----
function startBrowse() {
  const d = dbs.find((v) => v.id === curDb);
  if (!d) return;
  $("dbBrowse").hidden = false;
  $("dbName").textContent = d.name;
  $("dbPlayer").value = ""; $("dbSide").value = ""; $("dbRes").value = ""; $("dbY1").value = ""; $("dbY2").value = "";
  $("fdRows").innerHTML = ""; $("fdProg").textContent = ""; $("evRows").innerHTML = ""; $("evProg").textContent = "";
  dbTab("games");
  search(true);
}
async function search(reset) {
  if (busy || !curDb) return;
  busy = true;
  if (reset) { offset = 0; $("dbRows").innerHTML = ""; lastQ = { id: curDb, player: $("dbPlayer").value, side: $("dbSide").value, result: $("dbRes").value, yearFrom: Number($("dbY1").value) || 0, yearTo: Number($("dbY2").value) || 0 }; }
  $("dbMore").hidden = true;
  if (reset) $("dbRows").innerHTML = `<p class="muted">Buscando…</p>`;
  try {
    const pg = await invoke("db_page", { id: lastQ.id, offset, limit: PAGE, player: lastQ.player, side: lastQ.side, result: lastQ.result, yearFrom: lastQ.yearFrom, yearTo: lastQ.yearTo });
    if (reset) $("dbRows").innerHTML = "";
    if (reset && !pg.rows.length) $("dbRows").innerHTML = `<p class="muted">Nenhuma partida encontrada.</p>`;
    $("dbRows").insertAdjacentHTML("beforeend", pg.rows.map((r) =>
      `<button class="dbrow" data-i="${r.i}"><span class="n">${fmtN(r.i + 1)}</span><span class="pl"><b>${esc(r.white)}</b>${r.welo ? ` <small>${r.welo}</small>` : ""}</span><span class="rs">${esc(r.result.replace("1/2-1/2", "½-½"))}</span><span class="pl"><b>${esc(r.black)}</b>${r.belo ? ` <small>${r.belo}</small>` : ""}</span><span class="yr">${r.year || ""}</span></button>`).join(""));
    offset += pg.rows.length;
    $("dbMore").hidden = !pg.more;
  } catch (e) { $("dbRows").innerHTML = `<p class="muted">${esc(String(e))}</p>`; }
  busy = false;
}
$("dbGo").onclick = () => search(true);
$("dbPlayer").onkeydown = (e) => { if (e.key === "Enter") search(true); };
$("dbMore").onclick = () => search(false);
$("dbRows").addEventListener("click", async (e) => {
  const b = e.target.closest(".dbrow");
  if (!b || !openGame) return;
  try {
    const text = await invoke("db_game", { id: lastQ.id, index: Number(b.dataset.i) });
    const d = dbs.find((v) => v.id === lastQ.id);
    await openGame(text, d?.name || "");
  } catch (err) { toast(String(err)); }
});

// ---- abas: Partidas / Posição / Torneios ----
function dbTab(t) {
  for (const b of $("dbTabs").querySelectorAll("button")) b.classList.toggle("on", b.dataset.t === t);
  for (const p of ["games", "pos", "ev"]) $("dbp-" + p).hidden = p !== t;
}
$("dbTabs").onclick = (e) => { const b = e.target.closest("button"); if (b) dbTab(b.dataset.t); };

// ---- busca por posição / padrão ----
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const GL = { P: "♙", N: "♘", B: "♗", R: "♖", Q: "♕", K: "♔", p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" };
let fdFen = "", fdBusy = false, fdDb = null;
function drawPrev(fen) {
  const cv = $("fdPrev"), g = cv.getContext("2d"), s = cv.width / 8;
  cv.hidden = false;
  const rows = fen.split(" ")[0].split("/");
  g.font = `${s * 0.8}px serif`; g.textAlign = "center"; g.textBaseline = "middle";
  for (let r = 0; r < 8; r++) {
    let f = 0;
    const cells = [];
    for (const ch of rows[r]) { if (/\d/.test(ch)) for (let k = 0; k < +ch; k++) cells.push(""); else cells.push(ch); }
    for (f = 0; f < 8; f++) {
      g.fillStyle = (r + f) % 2 ? "#868e96" : "#e9ecef"; g.fillRect(f * s, r * s, s, s);
      if (cells[f]) { g.fillStyle = cells[f] === cells[f].toUpperCase() ? "#fff" : "#111"; g.strokeStyle = "#000"; g.lineWidth = 1; g.fillText(GL[cells[f]], f * s + s / 2, r * s + s / 2 + 2); }
    }
  }
}
$("fdPick").onclick = async () => {
  const fen = await openEditor(fdFen || START, { pattern: true });
  if (!fen) return;
  fdFen = fen; drawPrev(fen);
  $("fdFen").textContent = fen.split(" ")[0];
};
const plyLabel = (p) => `${Math.ceil(p / 2)}${p % 2 ? "." : "…"}`;
function fdRow(h) {
  const r = h.row;
  return `<button class="dbrow" data-i="${r.i}" data-ply="${h.ply}"><span class="n">${fmtN(r.i + 1)}</span><span class="pl"><b>${esc(r.white)}</b>${r.welo ? ` <small>${r.welo}</small>` : ""}</span><span class="rs">${esc(r.result.replace("1/2-1/2", "½-½"))}</span><span class="pl"><b>${esc(r.black)}</b>${r.belo ? ` <small>${r.belo}</small>` : ""}</span><span class="yr">lance ${plyLabel(h.ply)}</span></button>`;
}
$("fdGo").onclick = async () => {
  if (!curDb) return;
  if (!fdFen) { toast("Monte a posição primeiro."); return; }
  if (fdBusy) return;
  fdBusy = true; fdDb = curDb;
  $("fdRows").innerHTML = ""; $("fdProg").textContent = "Procurando…";
  $("fdGo").hidden = true; $("fdStop").hidden = false;
  try {
    await invoke("db_find", { id: curDb, fen: fdFen, exact: $("fdMode").value === "exact", max: Number($("fdMax").value), player: $("dbPlayer").value, side: $("dbSide").value });
  } catch (e) { fdEnd(); $("fdProg").textContent = String(e); }
};
$("fdStop").onclick = () => invoke("db_find_cancel");
function fdEnd() { fdBusy = false; $("fdGo").hidden = false; $("fdStop").hidden = true; }
if (T.event?.listen) {
  T.event.listen("dbfind-hit", (e) => $("fdRows").insertAdjacentHTML("beforeend", fdRow(e.payload)));
  T.event.listen("dbfind-progress", (e) => { const p = e.payload; (evBusy ? $("evProg") : $("fdProg")).textContent = `Procurando… ${fmtN(p.done)} de ${fmtN(p.total)} partidas · ${fmtN(p.found)} encontradas`; });
  T.event.listen("dbfind-done", (e) => {
    const p = e.payload; fdEnd();
    $("fdProg").textContent = !p.ok ? String(p.error) : `${p.cancelled ? "Cancelado. " : ""}${fmtN(p.found)} partida${p.found === 1 ? "" : "s"} encontrada${p.found === 1 ? "" : "s"} em ${fmtN(p.scanned)} analisadas.`;
    if (p.ok && !p.found && !p.cancelled) $("fdRows").innerHTML = `<p class="muted">Nenhuma partida com essa posição.</p>`;
  });
}
$("fdRows").addEventListener("click", async (e) => {
  const b = e.target.closest(".dbrow");
  if (!b || !openGame || !fdDb) return;
  try {
    const text = await invoke("db_game", { id: fdDb, index: Number(b.dataset.i) });
    const d = dbs.find((v) => v.id === fdDb);
    await openGame(text, d?.name || "", Number(b.dataset.ply));
  } catch (err) { toast(String(err)); }
});

// ---- busca por torneio ----
let evBusy = false, evDb = null;
function evRow(h) {
  const r = h.row;
  return `<button class="dbrow evrow" data-i="${r.i}"><span class="n">${fmtN(r.i + 1)}</span><span class="pl"><b>${esc(r.white)}</b>${r.welo ? ` <small>${r.welo}</small>` : ""}</span><span class="rs">${esc(r.result.replace("1/2-1/2", "½-½"))}</span><span class="pl"><b>${esc(r.black)}</b>${r.belo ? ` <small>${r.belo}</small>` : ""}</span><span class="yr">${r.year || ""}</span><span class="evn">${esc(h.event)}${h.site && h.site !== "?" && h.site !== h.event ? ` · ${esc(h.site)}` : ""}</span></button>`;
}
function evEnd() { evBusy = false; $("evGo").hidden = false; $("evStop").hidden = true; }
$("evGo").onclick = async () => {
  if (!curDb || evBusy) return;
  const q = $("evQ").value.trim();
  if (q.length < 2) { toast("Digite pelo menos 2 letras do torneio."); $("evQ").focus(); return; }
  evBusy = true; evDb = curDb;
  $("evRows").innerHTML = ""; $("evProg").textContent = "Procurando…";
  $("evGo").hidden = true; $("evStop").hidden = false;
  try { await invoke("db_events", { id: curDb, query: q, max: Number($("evMax").value), player: $("dbPlayer").value, side: $("dbSide").value }); }
  catch (e) { evEnd(); $("evProg").textContent = String(e); }
};
$("evQ").onkeydown = (e) => { if (e.key === "Enter") $("evGo").click(); };
$("evStop").onclick = () => invoke("db_find_cancel");
if (T.event?.listen) {
  T.event.listen("dbev-hit", (e) => $("evRows").insertAdjacentHTML("beforeend", evRow(e.payload)));
  T.event.listen("dbev-done", (e) => {
    const p = e.payload; evEnd();
    $("evProg").textContent = !p.ok ? String(p.error) : `${p.cancelled ? "Cancelado. " : ""}${fmtN(p.found)} partida${p.found === 1 ? "" : "s"} encontrada${p.found === 1 ? "" : "s"} em ${fmtN(p.scanned)} partidas lidas.`;
    if (p.ok && !p.found && !p.cancelled) $("evRows").innerHTML = `<p class="muted">Nenhum torneio com esse nome.</p>`;
  });
}
$("evRows").addEventListener("click", async (e) => {
  const b = e.target.closest(".dbrow");
  if (!b || !openGame || !evDb) return;
  try {
    const text = await invoke("db_game", { id: evDb, index: Number(b.dataset.i) });
    await openGame(text, dbs.find((v) => v.id === evDb)?.name || "");
  } catch (err) { toast(String(err)); }
});

$("dbReport").onclick = () => {
  const name = $("dbPlayer").value.trim();
  if (!curDb) return;
  if (name.length < 2) { toast("Digite o nome do jogador no filtro “Jogador” (ex.: carlsen)."); $("dbPlayer").focus(); return; }
  openReport(dbs.find((v) => v.id === curDb), name, false, openGame);
};

// ---- manutenção ----
async function working(label, fn) {
  const btns = [$("dbMerge"), $("dbEmpty"), $("dbDups")];
  btns.forEach((b) => (b.disabled = true));
  toast(label);
  try { return await fn(); } catch (e) { toast(String(e)); } finally { btns.forEach((b) => (b.disabled = false)); }
}
const afterChange = async () => { await refresh(); search(true); };
$("dbEmpty").onclick = async () => {
  if (!curDb) return;
  if ((await askChoice("Remover partidas vazias", "Remove do índice as partidas sem nenhum lance. O PGN original não é alterado.", ["Remover", "Cancelar"])) !== 0) return;
  const r = await working("Procurando partidas vazias…", () => invoke("db_clean", { id: curDb, empty: true, dups: false }));
  if (r) { toast(`${fmtN(r.empty)} partidas vazias removidas`); afterChange(); }
};
$("dbDups").onclick = async () => {
  if (!curDb) return;
  if ((await askChoice("Remover duplicadas", "Considera duplicadas as partidas com os mesmos jogadores, data, resultado e os mesmos primeiros 30 lances; mantém a primeira. O PGN original não é alterado.", ["Remover", "Cancelar"])) !== 0) return;
  const r = await working("Procurando duplicadas…", () => invoke("db_clean", { id: curDb, empty: false, dups: true }));
  if (r) { toast(`${fmtN(r.dups)} duplicadas removidas`); afterChange(); }
};
$("dbMerge").onclick = () => {
  if (!curDb) return;
  const d = document.createElement("dialog");
  d.className = "mgdlg";
  d.innerHTML = `<b>Jogadores e mesclagem</b><p class="muted" style="font-size:13px">Busque as variações do nome (ex.: “carlsen”), marque as que são a mesma pessoa e escolha o nome final. Só o índice muda; o PGN original não é alterado.</p>
    <input type="text" id="mgQ" placeholder="Buscar jogador (mín. 2 letras)" spellcheck="false">
    <div class="mglist" id="mgList"></div>
    <label>Nome final</label><input type="text" id="mgTo" spellcheck="false">
    <div class="row"><button id="mgOk" disabled>Mesclar marcados</button><button class="ghost" id="mgNo">Fechar</button></div>`;
  document.body.appendChild(d);
  const q = (id) => d.querySelector("#" + id);
  let rows = [], timer = null;
  const sel = () => [...d.querySelectorAll("#mgList input:checked")].map((i) => rows[Number(i.dataset.i)].name);
  const upd = () => {
    const s = sel();
    q("mgOk").disabled = s.length < 1 || !q("mgTo").value.trim();
    q("mgOk").textContent = s.length ? `Mesclar ${s.length} em um` : "Mesclar marcados";
  };
  const find = async () => {
    const t = q("mgQ").value.trim();
    if (t.length < 2) { q("mgList").innerHTML = `<div class="hint">Digite pelo menos 2 letras.</div>`; return; }
    q("mgList").innerHTML = `<div class="hint">Buscando…</div>`;
    try { rows = await invoke("db_players", { id: curDb, query: t, limit: 200 }); } catch (e) { q("mgList").innerHTML = esc(String(e)); return; }
    q("mgList").innerHTML = rows.length ? rows.map((r, i) => `<label><input type="checkbox" data-i="${i}"><span>${esc(r.name)}</span><small>${fmtN(r.n)}</small></label>`).join("") : `<div class="hint">Ninguém encontrado.</div>`;
    upd();
  };
  q("mgQ").oninput = () => { clearTimeout(timer); timer = setTimeout(find, 300); };
  d.addEventListener("change", (e) => {
    if (e.target.closest("#mgList")) {
      const s = sel();
      if (s.length && !q("mgTo").dataset.touched) q("mgTo").value = s[0];
      upd();
    }
  });
  q("mgTo").oninput = () => { q("mgTo").dataset.touched = "1"; upd(); };
  q("mgNo").onclick = () => d.close();
  q("mgOk").onclick = async () => {
    const from = sel(), to = q("mgTo").value.trim();
    q("mgOk").disabled = true;
    try {
      const n = await invoke("db_merge_players", { id: curDb, from, to });
      toast(`${fmtN(n)} partidas atualizadas`);
      d.close(); search(true);
    } catch (e) { toast(String(e)); upd(); }
  };
  d.addEventListener("close", () => d.remove());
  d.showModal();
  q("mgQ").focus();
};

setWatcher((cb) => watch(cb));
