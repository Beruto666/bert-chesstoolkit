// Seletor de arquivos/pastas do próprio app. O diálogo nativo do Linux abre como outra janela (sem foco em alguns
// ambientes Wayland/tiling); este abre sempre na frente, já na pasta certa, e lembra a última pasta usada.
import { esc, ls, askChoice } from "./util.js";
// junta pasta + nome respeitando o separador do sistema (Linux "/" · Windows "\\")
const joinPath = (dir, n) => { if (dir === "::discos") return n; const sep = dir.includes("\\") ? "\\" : "/"; return dir.endsWith(sep) ? dir + n : dir + sep + n; };

const invoke = (c, a) => window.__TAURI__.core.invoke(c, a);
const icon = (d) => `<svg class="i"><use href="#i-${d ? "folder" : "file-text"}"/></svg>`;
const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : b >= 1e3 ? Math.round(b / 1e3) + " KB" : b + " B");

// o = { mode: "open"|"save"|"dir", multiple, extensions, name, filename, title }
// Devolve caminho (ou lista, se multiple), null se cancelou, undefined se o navegador de pastas não está disponível.
export async function browse(o = {}) {
  if (!window.__TAURI__?.core) return undefined;
  const mode = o.mode || "open";
  let first;
  try { first = await invoke("fs_list", { path: ls.get("lastDir") || "" }); } catch { try { first = await invoke("fs_list", { path: "" }); } catch { return undefined; } }
  if (!first || typeof first !== "object" || !first.path) return undefined;
  const exts = (o.extensions || ["*"]).map((e) => e.toLowerCase().replace(/^\./, ""));
  const anyExt = exts.includes("*");
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "fpdlg";
    const title = o.title || (mode === "save" ? "Salvar como" : mode === "dir" ? "Escolher pasta" : o.multiple ? "Escolher arquivos" : "Escolher arquivo");
    d.innerHTML = `<div class="fphead"><b>${esc(title)}</b><button class="ghost" data-no aria-label="Fechar">✕</button></div>
      <div class="fpbar"><button class="ghost" data-up title="Pasta acima" aria-label="Pasta acima">↑</button><input class="fppath" spellcheck="false" aria-label="Caminho"><input type="search" class="fpq" placeholder="Filtrar…" spellcheck="false"></div>
      <div class="fpmain"><nav class="fpplaces"></nav><div class="fplist" tabindex="0"></div></div>
      <div class="fpfoot">${mode === "save" ? `<input class="fpname" spellcheck="false" aria-label="Nome do arquivo">` : ""}${mode === "open" && !anyExt ? `<label class="sw"><input type="checkbox" class="fpall"> Todos os arquivos</label>` : ""}<span class="fpsel muted"></span><button data-ok></button><button class="ghost" data-no>Cancelar</button></div>`;
    const q = (s) => d.querySelector(s);
    let cur = first, sel = new Set(), out = null, home = first.places?.[0]?.path || "/";
    const okBtn = q("[data-ok]");
    okBtn.textContent = mode === "save" ? "Salvar" : mode === "dir" ? "Escolher esta pasta" : "Abrir";
    if (mode === "save") q(".fpname").value = o.filename || "";

    const visible = () => {
      const t = q(".fpq").value.trim().toLowerCase(), all = q(".fpall")?.checked;
      return cur.entries.filter((e) => {
        if (t && !e.n.toLowerCase().includes(t)) return false;
        if (e.d) return true;
        if (mode === "dir") return false;
        if (mode === "save" || anyExt || all) return true;
        return exts.includes((e.n.split(".").pop() || "").toLowerCase());
      });
    };
    const draw = () => {
      q(".fpplaces").innerHTML = cur.places.map((p) => `<button class="fpplace${p.path === cur.path ? " on" : ""}" data-p="${esc(p.path)}" title="${esc(p.path)}">${esc(p.name)}</button>`).join("");
      q(".fppath").value = cur.path;
      q("[data-up]").disabled = !cur.parent;
      const rows = visible();
      q(".fplist").innerHTML = rows.length ? rows.map((e) => `<div class="fprow${e.d ? " dir" : ""}${sel.has(e.n) ? " on" : ""}" data-n="${esc(e.n)}" data-d="${e.d ? 1 : 0}">${icon(e.d)}<span class="fpn">${esc(e.n)}</span><small>${e.d ? "" : fmtSize(e.s)}</small><small>${e.t ? new Date(e.t * 1000).toLocaleDateString("pt-BR") : ""}</small></div>`).join("") : `<div class="hint">${mode === "dir" ? "Sem subpastas." : "Nada para mostrar aqui."}</div>`;
      q(".fpsel").textContent = mode === "open" ? (sel.size ? `${sel.size} selecionado${sel.size > 1 ? "s" : ""}` : "") : "";
      okBtn.disabled = mode === "open" && !sel.size;
    };
    const go = async (path) => {
      try { cur = await invoke("fs_list", { path }); sel.clear(); q(".fpq").value = ""; draw(); q(".fplist").scrollTop = 0; }
      catch (e) { q(".fpsel").textContent = String(e); }
    };
    const finish = async () => {
      const join = (n) => joinPath(cur.path, n);
      if (mode === "dir") out = cur.path;
      else if (mode === "save") {
        let n = q(".fpname").value.trim();
        if (!n) return;
        if (exts[0] && !anyExt && !n.toLowerCase().endsWith("." + exts[0])) n += "." + exts[0];
        if (cur.entries.some((e) => e.n === n) && (await askChoice("Substituir arquivo?", `“${n}” já existe nesta pasta.`, ["Substituir", "Cancelar"])) !== 0) return;
        out = join(n);
      } else {
        if (!sel.size) return;
        const paths = [...sel].map(join);
        out = o.multiple ? paths : paths[0];
      }
      ls.set("lastDir", cur.path);
      d.close();
    };
    d.addEventListener("click", (e) => {
      if (e.target.closest("[data-no]")) { d.close(); return; }
      if (e.target.closest("[data-ok]")) { finish(); return; }
      if (e.target.closest("[data-up]")) { if (cur.parent) go(cur.parent); return; }
      const p = e.target.closest("[data-p]");
      if (p) { go(p.dataset.p); return; }
      const r = e.target.closest(".fprow");
      if (!r) return;
      const name = r.dataset.n;
      if (r.dataset.d === "1") { go(joinPath(cur.path, name)); return; }
      if (mode === "save") { q(".fpname").value = name; return; }
      if (o.multiple) { sel.has(name) ? sel.delete(name) : sel.add(name); } else { sel.clear(); sel.add(name); }
      draw();
    });
    d.addEventListener("dblclick", (e) => { const r = e.target.closest(".fprow"); if (r && r.dataset.d !== "1" && mode !== "dir") { if (!o.multiple) { sel.clear(); sel.add(r.dataset.n); } if (mode === "save") q(".fpname").value = r.dataset.n; finish(); } });
    q(".fpq").addEventListener("input", draw);
    q(".fpall")?.addEventListener("change", draw);
    q(".fppath").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(q(".fppath").value.trim().replace(/^~(?=\/|$)/, home)); } });
    q(".fpname")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(); } });
    d.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.target.closest("input,button") && mode === "open" && sel.size) { e.preventDefault(); finish(); }
      if (e.key === "Backspace" && !e.target.closest("input") && cur.parent) { e.preventDefault(); go(cur.parent); }
    });
    d.addEventListener("close", () => { d.remove(); resolve(out); });
    document.body.appendChild(d);
    d.showModal();
    draw();
    (mode === "save" ? q(".fpname") : q(".fpq")).focus();
  });
}
