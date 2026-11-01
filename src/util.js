// Pequenas utilidades compartilhadas
export const $ = (id) => document.getElementById(id);
export const ic = (n) => `<svg class="i"><use href="#i-${n}"/></svg>`;
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const FILES = "abcdefgh";
export const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
export const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

// ---- aviso rápido ----
export function toast(msg, ms = 2400) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = "show";
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = ""; }, ms);
}

// ---- copiar para a área de transferência (com plano B) ----
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

// ---- diálogos próprios (o webview não garante confirm/prompt) ----
// Escolha entre botões; devolve o índice (o primeiro é o principal) ou -1 se cancelou.
export function askChoice(title, text, labels) {
  return new Promise((res) => {
    const d = document.createElement("dialog");
    d.innerHTML = `<b>${esc(title)}</b><p style="color:var(--mu);font-size:14px;margin:10px 0 0">${esc(text)}</p><div class="row">${labels.map((l, i) => `<button data-i="${i}" class="${i === 0 ? "" : "ghost"}">${esc(l)}</button>`).join("")}</div>`;
    let out = -1;
    d.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { out = Number(b.dataset.i); d.close(); } });
    d.addEventListener("close", () => { d.remove(); res(out); });
    document.body.appendChild(d);
    d.showModal();
  });
}
// Formulário simples: campos [{key,label,value,area,list,placeholder}]; devolve {key:valor} ou null.
export function askForm(title, fields, ok = "OK") {
  return new Promise((res) => {
    const d = document.createElement("dialog");
    d.innerHTML = `<b>${esc(title)}</b>` + fields.map((f) =>
      `<label>${esc(f.label)}</label>` + (f.area
        ? `<textarea data-k="${f.key}" rows="${f.rows || 10}" spellcheck="false" placeholder="${esc(f.placeholder || "")}"></textarea>`
        : `<input type="text" data-k="${f.key}" ${f.list ? `list="${f.list}"` : ""} placeholder="${esc(f.placeholder || "")}">`)).join("") +
      `<div class="row"><button data-ok>${esc(ok)}</button><button class="ghost" data-no>Cancelar</button></div>`;
    for (const f of fields) d.querySelector(`[data-k="${f.key}"]`).value = f.value ?? "";
    let out = null;
    d.addEventListener("click", (e) => {
      if (e.target.closest("[data-ok]")) { out = Object.fromEntries(fields.map((f) => [f.key, d.querySelector(`[data-k="${f.key}"]`).value])); d.close(); }
      else if (e.target.closest("[data-no]")) d.close();
    });
    d.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && e.target.tagName === "INPUT") { e.preventDefault(); d.querySelector("[data-ok]").click(); } });
    d.addEventListener("close", () => { d.remove(); res(out); });
    document.body.appendChild(d);
    d.showModal();
    d.querySelector("[data-k]")?.focus();
  });
}

// Escolher arquivo(s)/pasta: seletor do próprio app (sempre na frente, começa na última pasta usada). Devolve o caminho
// (ou lista), null se cancelou, undefined se não há como (aí o chamador usa o <input type=file>).
export async function pickPaths({ multiple = false, extensions = ["pgn"], name = "PGN", directory = false } = {}) {
  const { browse } = await import("./filepicker.js");
  return browse({ mode: directory ? "dir" : "open", multiple, extensions, name }); // undefined = o chamador usa o <input type=file>
}
// Escolher onde salvar: devolve o caminho completo, null se cancelou, undefined se não há como.
export async function pickSave({ filename = "", extensions = ["pgn"], title } = {}) {
  const { browse } = await import("./filepicker.js");
  return browse({ mode: "save", extensions, filename, title });
}
// Liga um botão a um <input type=file> escondido: usa o seletor do app e cai no input se não existir.
export function pgnPicker(btn, input, multiple, onFiles) {
  input.onchange = async (e) => {
    const fl = [...e.target.files]; e.target.value = "";
    if (fl.length) onFiles(await Promise.all(fl.map(async (f) => ({ name: f.name, text: await f.text() }))));
  };
  btn.onclick = async () => {
    const r = await pickPaths({ multiple });
    if (r === undefined) { input.click(); return; }
    if (!r) return;
    const T = window.__TAURI__;
    const paths = Array.isArray(r) ? r : [r];
    onFiles(await Promise.all(paths.map(async (p) => ({ name: String(p).split(/[\\/]/).pop(), text: await T.core.invoke("read_file_text", { path: p }) }))));
  };
}
