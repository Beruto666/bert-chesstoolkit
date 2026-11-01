// Seletores com a cara do app: o <select> continua no lugar (layout, valor e eventos intactos), mas a lista nativa
// (que no Linux abre cobrindo o tabuleiro e destoa do tema) é trocada por um menu próprio. Listas de coisas do usuário
// (repertórios, capítulos, conjuntos de puzzles, databases) abrem numa janela de escolha com busca.
import { esc } from "./util.js";

const AS_DIALOG = new Set(["rpSel", "rpChap", "setSel", "exDb"]);
let menu = null, off = null;

function close() { if (off) off(); off = null; menu?.remove(); menu = null; }
function choose(sel, i) {
  if (sel.selectedIndex !== i) {
    sel.selectedIndex = i;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
const items = (sel) => [...sel.options].map((o, i) => ({ i, text: o.textContent.trim() || "—", off: o.disabled }));

function popover(sel) {
  close();
  const list = items(sel);
  if (!list.length) return;
  const host = sel.closest("dialog") || document.body;
  const m = document.createElement("div");
  m.className = "ddmenu";
  m.setAttribute("role", "listbox");
  m.innerHTML = list.map((o) => `<div class="ddi${o.i === sel.selectedIndex ? " on" : ""}${o.off ? " off" : ""}" role="option" data-i="${o.i}">${esc(o.text)}</div>`).join("");
  host.appendChild(m);
  const r = sel.getBoundingClientRect();
  m.style.minWidth = Math.max(r.width, 140) + "px";
  const h = Math.min(m.scrollHeight, Math.min(innerHeight * 0.5, 360));
  m.style.maxHeight = h + "px";
  const below = innerHeight - r.bottom - 8, up = r.top - 8;
  const top = below >= h || below >= up ? r.bottom + 4 : r.top - h - 4;
  m.style.top = Math.max(4, top) + "px";
  m.style.left = Math.max(4, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + "px";
  menu = m;
  let hi = Math.max(0, sel.selectedIndex);
  const mark = () => { [...m.children].forEach((c, k) => c.classList.toggle("hi", k === hi)); m.children[hi]?.scrollIntoView({ block: "nearest" }); };
  mark();
  const onDown = (e) => { if (!m.contains(e.target)) close(); };
  const onClick = (e) => { const it = e.target.closest(".ddi"); if (it && !it.classList.contains("off")) { const i = Number(it.dataset.i); close(); choose(sel, i); sel.focus(); } };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); hi = Math.min(list.length - 1, hi + 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); hi = Math.max(0, hi - 1); mark(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); const i = hi; close(); choose(sel, i); }
  };
  m.addEventListener("click", onClick);
  m.addEventListener("mousemove", (e) => { const it = e.target.closest(".ddi"); if (it) { hi = Number(it.dataset.i); mark(); } });
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", close);
  off = () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", close); };
}

function chooser(sel) {
  close();
  const list = items(sel);
  const d = document.createElement("dialog");
  d.className = "ddlg";
  const title = sel.getAttribute("aria-label") || sel.title || "Escolher";
  d.innerHTML = `<b>${esc(title)}</b>${list.length > 7 ? `<input type="search" class="ddq" placeholder="Buscar…" spellcheck="false">` : ""}<div class="ddlist">${list.map((o) => `<button class="ddrow${o.i === sel.selectedIndex ? " on" : ""}" data-i="${o.i}"${o.off ? " disabled" : ""}>${esc(o.text)}</button>`).join("")}</div><div class="row"><button class="ghost" data-no>Cancelar</button></div>`;
  d.addEventListener("click", (e) => {
    if (e.target.closest("[data-no]")) { d.close(); return; }
    const b = e.target.closest(".ddrow");
    if (b) { const i = Number(b.dataset.i); d.close(); choose(sel, i); }
  });
  const q = d.querySelector(".ddq");
  if (q) q.oninput = () => { const t = q.value.toLowerCase(); d.querySelectorAll(".ddrow").forEach((b) => { b.hidden = !!t && !b.textContent.toLowerCase().includes(t); }); };
  d.addEventListener("close", () => d.remove());
  document.body.appendChild(d);
  d.showModal();
  d.querySelector(".ddrow.on")?.scrollIntoView({ block: "center" });
  (q || d.querySelector(".ddrow.on"))?.focus();
}

export function enhance(sel) {
  if (sel._dd || sel.multiple) return;
  sel._dd = true;
  const open = () => { if (sel.disabled) return; (AS_DIALOG.has(sel.id) ? chooser : popover)(sel); };
  sel.addEventListener("mousedown", (e) => { if (e.button !== 0) return; e.preventDefault(); sel.focus(); if (menu) close(); else open(); });
  sel.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " " || ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.altKey)) && !e.ctrlKey) { e.preventDefault(); open(); }
  });
}
export const enhanceAll = (root = document) => root.querySelectorAll("select").forEach(enhance);
