// Perfis de jogador: um perfil agrupa várias contas (ex.: Lichess + Chess.com) da mesma pessoa.
// Mostra as estatísticas somadas e baixa as partidas de todas as contas numa única database
// (com os nomes unificados no nome do perfil, então o explorador "só jogos de fulano" funciona nas duas contas).
import { $, esc, ic, ls, toast, askChoice } from "./util.js";
import { get, liProfile, ccProfile, pct } from "./profile.js";

const T = window.__TAURI__;
const invoke = (c, a) => T.core.invoke(c, a);
const SITE = { lichess: "Lichess", chesscom: "Chess.com" };
let profiles = [];
try { profiles = JSON.parse(ls.get("profiles") || "[]"); } catch { profiles = []; }
const persist = () => ls.set("profiles", JSON.stringify(profiles));
let startFetch = null; // definido pelo dbview: começa a observar a importação (barra de progresso)
export const setWatcher = (fn) => { startFetch = fn; };

export function render() {
  const box = $("pfList");
  if (!box) return;
  box.innerHTML = profiles.length
    ? profiles.map((p) => `<div class="pfcard" data-id="${p.id}">
        <div class="pfhead"><b>${esc(p.name)}</b>${p.dbId ? `<small>database vinculada</small>` : ""}</div>
        <div class="pfacc">${p.accounts.map((a) => `<span class="pfchip ${a.site}">${SITE[a.site]}: ${esc(a.user)}</span>`).join("")}</div>
        <div class="pfbtns"><button class="ghost" data-act="stats">${ic("info")}Estatísticas</button><button class="ghost" data-act="get">${ic("download")}${p.dbId ? "Atualizar partidas" : "Baixar partidas"}</button><button class="ghost" data-act="edit">Editar</button><button class="ghost" data-act="del">Excluir</button></div>
      </div>`).join("")
    : `<p class="muted">Nenhum perfil ainda. Crie um para juntar as contas de uma mesma pessoa (ex.: Lichess + Chess.com).</p>`;
}

// ---- criar / editar ----
function editor(p) {
  return new Promise((res) => {
    const d = document.createElement("dialog");
    d.className = "pfdlg";
    const rows = (p ? p.accounts : [{ site: "lichess", user: "" }, { site: "chesscom", user: "" }]).map((a) => ({ ...a }));
    const draw = () => {
      d.innerHTML = `<b>${p ? "Editar perfil" : "Novo perfil"}</b>
        <label>Nome da pessoa</label><input type="text" id="pfName" spellcheck="false" placeholder="Ex.: Joãozinho" value="${esc(p ? p.name : d._name || "")}">
        <label>Contas</label>
        <div id="pfRows">${rows.map((a, i) => `<div class="pfrow"><select data-i="${i}" data-k="site"><option value="lichess" ${a.site === "lichess" ? "selected" : ""}>Lichess</option><option value="chesscom" ${a.site === "chesscom" ? "selected" : ""}>Chess.com</option></select><input type="text" data-i="${i}" data-k="user" spellcheck="false" placeholder="Usuário" value="${esc(a.user)}"><button class="ghost" data-rm="${i}" title="Remover conta">×</button></div>`).join("")}</div>
        <button class="ghost" id="pfAdd">+ Outra conta</button>
        <div class="row"><button id="pfOk">Salvar</button><button class="ghost" id="pfNo">Cancelar</button></div>`;
    };
    draw();
    const sync = () => { d._name = d.querySelector("#pfName").value; for (const el of d.querySelectorAll("[data-k]")) rows[Number(el.dataset.i)][el.dataset.k] = el.value; };
    d.addEventListener("click", (e) => {
      if (e.target.closest("#pfAdd")) { sync(); rows.push({ site: "lichess", user: "" }); draw(); return; }
      const rm = e.target.closest("[data-rm]");
      if (rm) { sync(); rows.splice(Number(rm.dataset.rm), 1); draw(); return; }
      if (e.target.closest("#pfNo")) { d.close(); return; }
      if (e.target.closest("#pfOk")) {
        sync();
        const name = d._name.trim(), accounts = rows.map((a) => ({ site: a.site, user: a.user.trim() })).filter((a) => a.user);
        if (!name) { toast("Dê um nome ao perfil."); return; }
        if (!accounts.length) { toast("Adicione pelo menos uma conta."); return; }
        if (accounts.some((a) => !/^[A-Za-z0-9_-]{1,40}$/.test(a.user))) { toast("Usuário inválido (use letras, números, _ ou -)."); return; }
        d._out = { name, accounts }; d.close();
      }
    });
    d.addEventListener("close", () => { d.remove(); res(d._out || null); });
    document.body.appendChild(d);
    d.showModal();
    d.querySelector("#pfName").focus();
  });
}
$("pfNew").onclick = async () => {
  const r = await editor(null);
  if (!r) return;
  profiles.unshift({ id: "pf" + Date.now(), name: r.name, accounts: r.accounts, dbId: null });
  persist(); render();
};

// ---- estatísticas somadas ----
async function accountProfile(a) {
  const u = encodeURIComponent(a.user);
  if (a.site === "lichess") return liProfile(await get(`https://lichess.org/api/user/${u}`));
  const low = encodeURIComponent(a.user.toLowerCase());
  const [p, s] = await Promise.all([get(`https://api.chess.com/pub/player/${low}`), get(`https://api.chess.com/pub/player/${low}/stats`)]);
  return ccProfile(p, s);
}
const errText = (err) => { const m = String(err?.message || err); return m === "notfound" ? "usuário não encontrado" : m === "rate" ? "muitas consultas, tente de novo" : m === "net" ? "sem conexão" : m; };
async function showStats(p) {
  const d = document.createElement("dialog");
  d.className = "pfdlg";
  d.innerHTML = `<b>${esc(p.name)}</b><p class="muted">Buscando contas…</p>`;
  d.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) d.close(); });
  d.addEventListener("close", () => d.remove());
  document.body.appendChild(d);
  d.showModal();
  const res = await Promise.all(p.accounts.map(async (a) => { try { return { a, pr: await accountProfile(a) }; } catch (err) { return { a, err: errText(err) }; } }));
  const ok = res.filter((r) => r.pr);
  const sum = ok.reduce((t, r) => ({ total: t.total + r.pr.total, win: t.win + r.pr.win, draw: t.draw + r.pr.draw, loss: t.loss + r.pr.loss }), { total: 0, win: 0, draw: 0, loss: 0 });
  d.innerHTML = `<b>${esc(p.name)}</b> <small style="color:var(--mu)">${p.accounts.length} ${p.accounts.length === 1 ? "conta" : "contas"} somadas</small>
    <div class="profsum">
      <div><small>Partidas</small><b>${sum.total.toLocaleString("pt-BR")}</b></div>
      <div><small>Vitórias</small><b style="color:var(--ok)">${pct(sum.win, sum.total)}</b></div>
      <div><small>Empates</small><b>${pct(sum.draw, sum.total)}</b></div>
      <div><small>Derrotas</small><b style="color:var(--bad)">${pct(sum.loss, sum.total)}</b></div>
    </div>
    <table class="proftab"><thead><tr><th>Conta</th><th>Modo</th><th>Rating</th><th>Partidas</th></tr></thead><tbody>${res.map((r) => {
      const site = SITE[r.a.site] + ": " + esc(r.a.user);
      if (r.err) return `<tr><td>${site}</td><td colspan="3" style="color:var(--bad)">${esc(r.err)}</td></tr>`;
      if (!r.pr.rows.length) return `<tr><td>${site}</td><td colspan="3" style="color:var(--mu)">Nenhum rating público.</td></tr>`;
      return r.pr.rows.map((x, i) => `<tr><td>${i ? "" : site}</td><td>${esc(x.nm)}</td><td><b>${x.rating}${x.prov ? "?" : ""}</b></td><td>${x.games ? x.games.toLocaleString("pt-BR") : "—"}</td></tr>`).join("");
    }).join("")}</tbody></table>
    <div class="row"><button data-close>Fechar</button></div>`;
}

// ---- baixar as partidas de todas as contas numa database ----
async function download(p) {
  if (!startFetch) return;
  if (p.dbId) {
    const c = await askChoice("Atualizar partidas", "Isto baixa tudo de novo e substitui a database antiga deste perfil.", ["Atualizar", "Cancelar"]);
    if (c !== 0) return;
  }
  const reset = await startFetch((payload) => {
    if (payload.ok) {
      if (p.dbId) invoke("db_delete", { id: p.dbId }).catch(() => {});
      p.dbId = payload.id; persist(); render();
    }
  });
  try { await invoke("db_profile", { name: p.name, accounts: p.accounts, max: 0 }); } catch (e) { toast(String(e)); reset(); }
}

$("pfList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const p = profiles.find((x) => x.id === b.closest(".pfcard").dataset.id);
  if (!p) return;
  const act = b.dataset.act;
  if (act === "stats") showStats(p);
  else if (act === "get") download(p);
  else if (act === "edit") {
    const r = await editor(p);
    if (r) { p.name = r.name; p.accounts = r.accounts; persist(); render(); }
  } else if (act === "del") {
    if ((await askChoice("Excluir perfil", `Excluir o perfil “${p.name}”? A database baixada (se houver) não é apagada.`, ["Excluir", "Cancelar"])) !== 0) return;
    profiles = profiles.filter((x) => x.id !== p.id); persist(); render();
  }
});
render();
