// Aparência compartilhada (peças, tabuleiro, coordenadas, tamanho) entre Puzzles e Análise
import { $, GLYPH, ls } from "./util.js";
import { getOne, putRec, storeReady } from "./store.js";
import { lang, setLang } from "./i18n.js";

const listeners = [];
export const onLook = (fn) => listeners.push(fn); // chamado quando a aparência muda

// ---------- aparência ----------
const THEMES = {
  azul: ["Azul-cinza (padrão)", "#e9ecef", "#868e96"],
  classico: ["Clássico", "#f0d9b5", "#b58863"],
  verde: ["Verde", "#eeeed2", "#769656"],
  azulclaro: ["Azul", "#dee3e6", "#8ca2ad"],
  madeira: ["Madeira escura", "#d7b98a", "#8b5a2b"],
  roxo: ["Roxo", "#efefef", "#8877b7"],
  cinza: ["Cinza", "#dcdcdc", "#9a9a9a"],
};
const PSETS = [["staunty", "Staunty"], ["cburnett", "Cburnett"], ["merida", "Merida"], ["chessnut", "Chessnut"],
  ["tatiana", "Tatiana"], ["cardinal", "Cardinal"], ["celtic", "Celtic"], ["mpchess", "MP Chess"], ["fresca", "Fresca"],
  ["capivara", "Capivara"], ["font", "Símbolos (fonte)"], ["custom", "Personalizado (minhas imagens)"]];
export const prefs = { set: "staunty", theme: "azul", light: "#e9ecef", dark: "#868e96", coords: true, anim: true, sound: true, app: "black", size: 0 }; // size 0 = automático
try { Object.assign(prefs, JSON.parse(ls.get("prefs") || "{}")); } catch {}
const setAppTheme = () => { if (prefs.app && prefs.app !== "auto") document.documentElement.dataset.app = prefs.app; else delete document.documentElement.dataset.app; };
setAppTheme(); // antes da primeira pintura
const RASTER_SETS = new Map([["capivara", "webp"]]); // conjuntos em imagem (WebP); os demais são SVG
let customPieces = null;
const TYPE_NAMES = { king: "K", queen: "Q", rook: "R", bishop: "B", knight: "N", pawn: "P" };
function pieceSrc(color, type) {
  const key = color + type.toUpperCase();
  if (prefs.set === "custom") return customPieces?.[key] || null;
  if (prefs.set === "font") return null;
  return `pieces/${prefs.set}/${key}.${RASTER_SETS.get(prefs.set) || "svg"}`;
}
export function pieceHtml(color, type, cls = "") {
  const src = pieceSrc(color, type);
  return src
    ? `<img class="piece ${color} ${cls}" src="${src}" draggable="false" alt="">`
    : `<span class="piece glyph ${color} ${cls}">${GLYPH[type]}\uFE0E</span>`;
}
function keyFromName(name) {
  const b = name.toLowerCase().replace(/\.[^.]+$/, "");
  let m = b.match(/^([wb])([kqrbnp])$/);
  if (m) return m[1] + m[2].toUpperCase();
  m = b.match(/(white|black)[-_ ]?(king|queen|rook|bishop|knight|pawn)/);
  if (m) return (m[1] === "white" ? "w" : "b") + TYPE_NAMES[m[2]];
  return null;
}
const readUrl = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); });
// ---------- tamanho do tabuleiro ----------
const MIN_SIZE = 320, MAX_SIZE = 1400;
function autoSize() {
  const main = document.querySelector(".view.on .fitmain");
  if (!main) return 0; // nenhuma tela com tabuleiro visível
  const top = main.getBoundingClientRect().top;
  const side = Number(main.dataset.side) || 380;   // largura ocupada pelo painel ao lado
  const below = Number(main.dataset.below) || 0;   // altura reservada abaixo do tabuleiro
  const byH = window.innerHeight - top - 24 - below;
  const sideBySide = window.innerWidth - 36 - side;
  const byW = sideBySide >= 420 ? sideBySide : window.innerWidth - 36;
  return Math.floor(Math.min(byH, byW));
}
export function fitBoard() {
  const auto = autoSize();
  let s = prefs.size ? prefs.size : auto;
  if (!s) return; // escondido: tenta de novo quando a tela abrir
  s = Math.max(MIN_SIZE, Math.min(MAX_SIZE, s, Math.max(MIN_SIZE, window.innerWidth - 36)));
  document.documentElement.style.setProperty("--s", s + "px");
  if (!prefs.size) { // tamanho automático: se a página ainda ficou mais alta que a janela (ex.: barra de ferramentas quebrou em 2 linhas), encolhe o tabuleiro só o necessário
    const ex = document.documentElement.scrollHeight - window.innerHeight;
    if (ex > 1 && ex < 120 && s - ex >= MIN_SIZE) { s -= ex; document.documentElement.style.setProperty("--s", s + "px"); }
  }
  $("bSize").value = s;
  $("szVal").textContent = prefs.size ? `${s}px` : `${s}px (auto)`;
  $("bAuto").checked = !prefs.size;
}
function savePrefs() { ls.set("prefs", JSON.stringify(prefs)); }
function initResize() {
  window.addEventListener("resize", fitBoard);
  $("bAuto").onchange = (e) => {
    prefs.size = e.target.checked ? 0 : Number(document.documentElement.style.getPropertyValue("--s").replace("px", "")) || 640;
    savePrefs(); fitBoard();
  };
  $("bSize").oninput = (e) => { prefs.size = Number(e.target.value); fitBoard(); };
  $("bSize").onchange = savePrefs;
  for (const h of document.querySelectorAll(".rz")) bindHandle(h);
}
function bindHandle(h) {
  h.addEventListener("dblclick", () => { prefs.size = 0; savePrefs(); fitBoard(); });
  h.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY;
    const s0 = Number(document.documentElement.style.getPropertyValue("--s").replace("px", "")) || 640;
    const move = (ev) => {
      const d = ((ev.clientX - x0) + (ev.clientY - y0)) / 2; // arrastar na diagonal
      prefs.size = Math.round(Math.max(MIN_SIZE, Math.min(MAX_SIZE, s0 + d)) / 4) * 4;
      fitBoard();
    };
    const up = () => { h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); savePrefs(); };
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", up);
    h.addEventListener("pointercancel", up);
  });
}

export function applyLook(save = true) {
  const t = THEMES[prefs.theme];
  const light = t ? t[1] : prefs.light, dark = t ? t[2] : prefs.dark;
  document.documentElement.style.setProperty("--light", light);
  document.documentElement.style.setProperty("--dark", dark);
  document.body.classList.toggle("nocoords", !prefs.coords);
  setAppTheme();
  if (save) ls.set("prefs", JSON.stringify(prefs));
  $("aTheme").value = prefs.app || "auto";
  $("pSet").value = prefs.set;
  $("bTheme").value = prefs.theme;
  $("cLight").value = light; $("cDark").value = dark;
  $("customRow").hidden = prefs.set !== "custom";
  $("pCredit").hidden = prefs.set !== "capivara";
  $("bCustom").hidden = prefs.theme !== "custom";
  $("coords").checked = prefs.coords;
  $("anim").checked = prefs.anim;
  $("snd").checked = prefs.sound;
  $("pPrev").innerHTML = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"]
    .map((k) => pieceHtml(k[0], k[1].toLowerCase())).join("");
  fitBoard();
  listeners.forEach((f) => f());
}
function initLook() {
  $("pSet").innerHTML = PSETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  $("bTheme").innerHTML = Object.entries(THEMES).map(([v, t]) => `<option value="${v}">${t[0]}</option>`).join("") + `<option value="custom">Personalizado (escolher cores)</option>`;
  if (prefs.set === "custom" && !customPieces) prefs.set = "font";
  if (!THEMES[prefs.theme] && prefs.theme !== "custom") prefs.theme = "azul";
  for (const b of document.querySelectorAll("[data-look]")) b.onclick = (e) => { e.stopPropagation(); $("look").hidden = !$("look").hidden; };
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") $("look").hidden = true; });
  document.addEventListener("pointerdown", (e) => { if (!$("look").hidden && !e.target.closest("#look, #gear, .ddmenu, dialog")) $("look").hidden = true; });
  $("lang").value = lang;
  $("lang").onchange = (e) => setLang(e.target.value);
  $("lichTok").onclick = () => import("./explorer.js").then((m) => m.askToken());
  $("pSet").onchange = (e) => { prefs.set = e.target.value; if (prefs.set === "custom" && !customPieces) $("pMsg").textContent = "Escolha as 12 imagens para usar este modo."; applyLook(); };
  $("bTheme").onchange = (e) => {
    prefs.theme = e.target.value;
    if (prefs.theme === "custom") { prefs.light = $("cLight").value; prefs.dark = $("cDark").value; }
    applyLook();
  };
  $("cLight").oninput = (e) => { prefs.theme = "custom"; prefs.light = e.target.value; applyLook(); };
  $("cDark").oninput = (e) => { prefs.theme = "custom"; prefs.dark = e.target.value; applyLook(); };
  $("coords").onchange = (e) => { prefs.coords = e.target.checked; applyLook(); };
  $("anim").onchange = (e) => { prefs.anim = e.target.checked; applyLook(); };
  $("sndDir").onclick = () => window.__TAURI__.core.invoke("sound_folder").catch(() => {});
  $("aTheme").onchange = (e) => { prefs.app = e.target.value; applyLook(); };
  $("snd").onchange = (e) => { prefs.sound = e.target.checked; applyLook(); if (prefs.sound) import("./sound.js").then((m) => m.play("move")); };
  $("pCustom").onclick = () => $("pFiles").click();
  $("pFiles").onchange = async (e) => {
    const map = {};
    for (const f of e.target.files) {
      const k = keyFromName(f.name);
      if (k) map[k] = await readUrl(f);
    }
    e.target.value = "";
    const need = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];
    const miss = need.filter((k) => !map[k]);
    if (miss.length) { $("pMsg").textContent = `Faltam: ${miss.join(", ")}. Nomeie os arquivos como wK.svg, bP.png etc.`; return; }
    customPieces = map;
    await putRec("prefs", { id: "custompieces", map });
    $("pMsg").textContent = "Peças personalizadas carregadas.";
    prefs.set = "custom";
    applyLook();
  };
  initResize();
}

export const lookReady = storeReady.then(async () => {
  customPieces = (await getOne("prefs", "custompieces"))?.map || null;
  initLook();
  applyLook(false);
});
