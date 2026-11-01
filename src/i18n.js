// Idioma do app: português (padrão) ou inglês. No inglês, os textos da tela são trocados pelo dicionário em i18n_en.js
// (texto exato primeiro; depois frases conhecidas dentro do texto). Trocar de idioma recarrega o app.
import { ls } from "./util.js";

export const lang = ls.get("lang") === "en" ? "en" : "pt";
document.documentElement.lang = lang === "en" ? "en" : "pt-BR";
export function setLang(l) { ls.set("lang", l === "en" ? "en" : "pt"); location.reload(); }

if (lang === "en") {
  const PAIRS = (await import("./i18n_en.js")).default; // só carrega no inglês
  const exact = new Map(PAIRS.map(([p, e]) => [p, e]));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // frases (4+ letras) dentro de textos maiores, das mais longas para as mais curtas; só em fronteira de palavra
  const parts = PAIRS.map(([p]) => p.trim()).filter((p) => p.length >= 4 && /\p{L}/u.test(p)).sort((a, b) => b.length - a.length);
  const re = new RegExp(parts.map((p) => `(?<![\\p{L}\\p{N}])${esc(p)}(?![\\p{L}\\p{N}])`).join("|"), "gu");
  const cache = new Map();
  function tr(s) {
    const t = s.trim();
    if (!t) return s;
    let out = cache.get(t);
    if (out === undefined) {
      out = exact.get(t);
      if (out === undefined) { const r = t.replace(re, (m) => exact.get(m) ?? m); out = r; }
      if (cache.size > 5000) cache.clear();
      cache.set(t, out);
    }
    if (out === t) return s;
    return s.slice(0, s.indexOf(t)) + out + s.slice(s.indexOf(t) + t.length);
  }
  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE"]);
  const ATTRS = ["title", "placeholder", "aria-label", "alt"];
  const skipEl = (el) => !el || SKIP.has(el.tagName) || (el.closest && el.closest("[translate=no]"));
  function node(n) {
    if (n.nodeType === 3) { if (!skipEl(n.parentElement)) { const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } return; }
    if (n.nodeType !== 1 || skipEl(n)) return;
    for (const a of ATTRS) if (n.hasAttribute(a)) { const o = n.getAttribute(a), v = tr(o); if (v !== o) n.setAttribute(a, v); }
    if (n.tagName === "INPUT" && n.placeholder) { const v = tr(n.placeholder); if (v !== n.placeholder) n.placeholder = v; }
    for (const c of n.childNodes) node(c);
  }
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach(node);
      else if (m.type === "characterData") node(m.target);
      else if (m.type === "attributes") node(m.target);
    }
  });
  const start = () => {
    node(document.body);
    document.title = tr(document.title);
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
}
