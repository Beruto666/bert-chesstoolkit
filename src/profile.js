// Perfil online (Lichess / Chess.com): ratings e estatísticas do usuário digitado na tela Databases.
import { $, esc, ic, toast } from "./util.js";

const T = window.__TAURI__;
export const get = async (url) => {
  const r = await T.core.invoke("http_get", { url });
  if (r.status === 404) throw new Error("notfound");
  if (r.status === 429) throw new Error("rate");
  if (r.status === 0) throw new Error("net");
  if (r.status !== 200) throw new Error("http " + r.status);
  return JSON.parse(r.body);
};
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString("pt-BR") : "—");
export const pct = (a, t) => (t ? Math.round((a / t) * 100) + "%" : "—");

const LI_MODES = [["bullet", "Bullet"], ["blitz", "Blitz"], ["rapid", "Rápidas"], ["classical", "Clássico"], ["correspondence", "Por correspondência"], ["puzzle", "Puzzles"]];
export function liProfile(j) {
  const rows = LI_MODES.filter(([k]) => j.perfs?.[k]?.games > 0 || (k === "puzzle" && j.perfs?.puzzle?.rating))
    .map(([k, nm]) => ({ nm, rating: j.perfs[k].rating, games: j.perfs[k].games, prov: !!j.perfs[k].prov }));
  const c = j.count || {};
  return {
    name: (j.title ? j.title + " " : "") + (j.username || j.id), since: fmtDate(j.createdAt), seen: fmtDate(j.seenAt),
    total: c.all || 0, win: c.win || 0, draw: c.draw || 0, loss: c.loss || 0, rows,
    link: `https://lichess.org/@/${j.username || j.id}`,
  };
}
const CC_MODES = [["chess_bullet", "Bullet"], ["chess_blitz", "Blitz"], ["chess_rapid", "Rápidas"], ["chess_daily", "Diárias"]];
export function ccProfile(p, s) {
  const rows = CC_MODES.filter(([k]) => s[k]?.last).map(([k, nm]) => {
    const r = s[k].record || {};
    return { nm, rating: s[k].last.rating, games: (r.win || 0) + (r.loss || 0) + (r.draw || 0), prov: false };
  });
  if (s.tactics?.highest) rows.push({ nm: "Táticas (melhor)", rating: s.tactics.highest.rating, games: 0, prov: false });
  let win = 0, draw = 0, loss = 0;
  for (const [k] of CC_MODES) { const r = s[k]?.record; if (r) { win += r.win || 0; draw += r.draw || 0; loss += r.loss || 0; } }
  return {
    name: (p.title ? p.title + " " : "") + (p.username || ""), since: fmtDate((p.joined || 0) * 1000), seen: fmtDate((p.last_online || 0) * 1000),
    total: win + draw + loss, win, draw, loss, rows, link: p.url || "",
  };
}

function show(site, pr) {
  const d = document.createElement("dialog");
  d.id = "profDlg";
  d.innerHTML = `<b>${esc(pr.name)}</b> <small style="color:var(--mu)">${site === "lichess" ? "Lichess" : "Chess.com"}</small>
    <div class="profsum">
      <div><small>Partidas</small><b>${pr.total.toLocaleString("pt-BR")}</b></div>
      <div><small>Vitórias</small><b style="color:var(--ok)">${pct(pr.win, pr.total)}</b></div>
      <div><small>Empates</small><b>${pct(pr.draw, pr.total)}</b></div>
      <div><small>Derrotas</small><b style="color:var(--bad)">${pct(pr.loss, pr.total)}</b></div>
    </div>
    <table class="proftab"><thead><tr><th>Modo</th><th>Rating</th><th>Partidas</th></tr></thead><tbody>${
      pr.rows.length ? pr.rows.map((r) => `<tr><td>${esc(r.nm)}</td><td><b>${r.rating}${r.prov ? "?" : ""}</b></td><td>${r.games ? r.games.toLocaleString("pt-BR") : "—"}</td></tr>`).join("") : `<tr><td colspan="3" style="color:var(--mu)">Nenhum rating público.</td></tr>`
    }</tbody></table>
    <div class="profmeta">Conta criada em ${esc(pr.since)} · visto por último em ${esc(pr.seen)}</div>
    <div class="row"><button id="pfGet">${ic("download")}Baixar partidas dele</button><button class="ghost" id="pfClose">Fechar</button></div>`;
  d.addEventListener("click", (e) => {
    if (e.target.closest("#pfClose")) d.close();
    else if (e.target.closest("#pfGet")) { d.close(); $("dbFetch").click(); }
  });
  d.addEventListener("close", () => d.remove());
  document.body.appendChild(d);
  d.showModal();
}

$("dbProfile").onclick = async () => {
  const site = $("dbSite").value, user = $("dbUser").value.trim();
  if (!user) { toast("Digite o nome do usuário."); return; }
  const btn = $("dbProfile");
  btn.disabled = true;
  try {
    const u = encodeURIComponent(user);
    if (site === "lichess") show(site, liProfile(await get(`https://lichess.org/api/user/${u}`)));
    else {
      const low = encodeURIComponent(user.toLowerCase());
      const [p, s] = await Promise.all([get(`https://api.chess.com/pub/player/${low}`), get(`https://api.chess.com/pub/player/${low}/stats`)]);
      show(site, ccProfile(p, s));
    }
  } catch (err) {
    const m = String(err?.message || err);
    toast(m === "notfound" ? "Usuário não encontrado." : m === "rate" ? "Muitas consultas: tente de novo em instantes." : m === "net" ? "Sem conexão com a internet." : "Não consegui consultar (" + m + ").", 3200);
  }
  btn.disabled = false;
};
