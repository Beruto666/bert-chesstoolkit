// Relatório de jogador: resumo, aproveitamento por cor, evolução do Elo e aberturas (tudo vindo do índice da database).
import { $, esc, toast } from "./util.js";
import { nameForSans } from "./openings.js";

const invoke = (c, a) => window.__TAURI__.core.invoke(c, a);
const fmtN = (n) => n.toLocaleString("pt-BR");
const pctOf = (e) => (e.n ? Math.round((100 * (e.w + e.d / 2)) / e.n) : 0); // % de pontos
const bar = (w, d, l) => { const t = w + d + l || 1; return `<span class="rbar"><i class="w" style="width:${(100 * w) / t}%"></i><i class="d" style="width:${(100 * d) / t}%"></i><i class="l" style="width:${(100 * l) / t}%"></i></span>`; };
function fmtSans(list) {
  let s = "";
  list.forEach((m, i) => { s += (i % 2 === 0 ? `${i / 2 + 1}.` : "") + m + " "; });
  return s.trim();
}
function chart(years) {
  const pts = years.filter((y) => y.elo > 0);
  if (pts.length < 2) return `<p class="muted" style="font-size:13px">Sem Elo suficiente por ano para o gráfico.</p>`;
  const W = 560, H = 140, pad = 28;
  const lo = Math.min(...pts.map((p) => p.elo)), hi = Math.max(...pts.map((p) => p.elo)), span = Math.max(40, hi - lo);
  const y0 = pts[0].year, y1 = pts[pts.length - 1].year;
  const x = (yr) => 46 + ((yr - y0) / Math.max(1, y1 - y0)) * (W - 46 - 20);
  const y = (e) => H - pad - ((e - lo) / span) * (H - 2 * pad);
  const line = pts.map((p) => `${x(p.year).toFixed(1)},${y(p.elo).toFixed(1)}`).join(" ");
  return `<svg class="rchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Elo médio por ano"><polyline points="${line}" fill="none" stroke="var(--ac)" stroke-width="2.4" stroke-linejoin="round"/>${pts.map((p) => `<circle cx="${x(p.year).toFixed(1)}" cy="${y(p.elo).toFixed(1)}" r="3" fill="var(--ac)"><title>${p.year}: Elo ${p.elo} (${p.n} partidas)</title></circle>`).join("")}<text x="46" y="${H - 8}" class="rax">${y0}</text><text x="${W - 20}" y="${H - 8}" class="rax" text-anchor="end">${y1}</text><text x="4" y="${y(hi) + 4}" class="rax">${hi}</text><text x="4" y="${y(lo) + 4}" class="rax">${lo}</text></svg>`;
}
function rows(list, total, label) {
  if (!list.length) return `<p class="muted" style="font-size:13px">Sem dados.</p>`;
  return `<div class="rtab">${list.map((l) => {
    const nm = nameForSans(l.san);
    return `<div class="rrow"><div class="rl"><b>${esc(label(l))}</b>${nm ? `<small>${esc(nm.eco)} · ${esc(nm.name)}</small>` : ""}</div><div class="rn">${fmtN(l.n)}<small>${total ? Math.round((100 * l.n) / total) : 0}%</small></div>${bar(l.w, l.d, l.l)}<div class="rp">${pctOf(l)}%</div></div>`;
  }).join("")}</div>`;
}

export async function openReport(db, player, exact, openGame) {
  const d = document.createElement("dialog");
  d.className = "rpt";
  d.innerHTML = `<div class="rhead"><b>Relatório: ${esc(player)}</b><button class="ghost" data-x>Fechar</button></div><div class="rbody"><p class="muted">Calculando…</p></div>`;
  d.addEventListener("close", () => d.remove());
  d.querySelector("[data-x]").onclick = () => d.close();
  document.body.appendChild(d);
  d.showModal();
  let r;
  try { r = await invoke("db_report", { id: db.id, player, exact }); } catch (e) { d.querySelector(".rbody").innerHTML = `<p>${esc(String(e))}</p>`; return; }
  const body = d.querySelector(".rbody");
  if (!r.games) { body.innerHTML = `<p class="muted">Nenhuma partida encontrada para “${esc(player)}”.</p>`; return; }
  const w = { n: r.white[0], w: r.white[1], d: r.white[2], l: r.white[3] }, b = { n: r.black[0], w: r.black[1], d: r.black[2], l: r.black[3] };
  const all = { n: w.n + b.n, w: w.w + b.w, d: w.d + b.d, l: w.l + b.l };
  const chip = (c) => `<button class="ghost chip" data-name="${esc(c.name)}" title="Refazer só com este nome">${esc(c.name)} <small>${fmtN(c.n)}</small></button>`;
  let h = `<div class="rnames"><small class="muted">Nomes incluídos:</small> ${r.names.map(chip).join("")}</div>
  <div class="stats rstats"><div class="stat"><small>Partidas</small><b>${fmtN(all.n)}</b></div><div class="stat"><small>Pontos</small><b>${pctOf(all)}%</b></div><div class="stat"><small>Elo pico</small><b>${r.peak || "—"}</b></div><div class="stat"><small>Elo recente</small><b>${r.last || "—"}</b></div><div class="stat"><small>Oponente médio</small><b>${r.opp || "—"}</b></div></div>
  <h3>Resultados</h3>
  <div class="rcol"><span>Brancas <small>${fmtN(w.n)} · ${pctOf(w)}%</small></span>${bar(w.w, w.d, w.l)}<small class="muted">${w.w}V ${w.d}E ${w.l}D</small></div>
  <div class="rcol"><span>Pretas <small>${fmtN(b.n)} · ${pctOf(b)}%</small></span>${bar(b.w, b.d, b.l)}<small class="muted">${b.w}V ${b.d}E ${b.l}D</small></div>
  <h3>Elo ao longo dos anos</h3>${chart(r.years)}`;
  if (r.ready) {
    h += `<h3>Aberturas</h3><div class="modes rmodes"><button data-side="w" class="on">Com brancas</button><button data-side="b">Com pretas</button></div>
    <div id="rSideW"><h4>Primeiro lance</h4>${rows(r.w_first, w.n, (l) => "1." + l.san[0])}<h4>Linhas mais jogadas</h4>${rows(r.w_lines, w.n, (l) => fmtSans(l.san))}</div>
    <div id="rSideB" hidden><h4>Resposta ao primeiro lance</h4>${rows(r.b_first, b.n, (l) => fmtSans(l.san))}<h4>Linhas mais jogadas</h4>${rows(r.b_lines, b.n, (l) => fmtSans(l.san))}</div>`;
  } else h += `<p class="muted">Esta database foi importada numa versão antiga e não tem os lances indexados; reimporte para ver as aberturas.</p>`;
  if (r.best.length) h += `<h3>Melhores vitórias (Elo do adversário)</h3><div class="rtab">${r.best.map((g) =>
    `<button class="dbrow" data-i="${g.i}"><span class="n">${fmtN(g.i + 1)}</span><span class="pl"><b>${esc(g.white)}</b>${g.welo ? ` <small>${g.welo}</small>` : ""}</span><span class="rs">${esc(g.result.replace("1/2-1/2", "½-½"))}</span><span class="pl"><b>${esc(g.black)}</b>${g.belo ? ` <small>${g.belo}</small>` : ""}</span><span class="yr">${g.year || ""}</span></button>`).join("")}</div>`;
  body.innerHTML = h;
  body.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-name]");
    if (c) { d.close(); openReport(db, c.dataset.name, true, openGame); return; }
    const m = e.target.closest(".rmodes button");
    if (m) {
      body.querySelectorAll(".rmodes button").forEach((x) => x.classList.toggle("on", x === m));
      $("rSideW").hidden = m.dataset.side !== "w"; $("rSideB").hidden = m.dataset.side !== "b";
      return;
    }
    const g = e.target.closest(".dbrow");
    if (g && openGame) { try { d.close(); await openGame(await invoke("db_game", { id: db.id, index: Number(g.dataset.i) }), db.name); } catch (err) { toast(String(err)); } }
  });
}
