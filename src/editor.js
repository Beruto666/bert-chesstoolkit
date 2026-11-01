// Editor de posição (estilo Lichess): paleta de peças, apagar, arrastar, vez, roques, en passant e campo FEN.
import { Chess } from "./vendor/chess.js";
import { $, esc, FILES } from "./util.js";
import { pieceHtml } from "./look.js";
import { parseFen } from "./board.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const EMPTY = "8/8/8/8/8/8/8/8 w - - 0 1";
const TYPES = ["k", "q", "r", "b", "n", "p"];

function toPlacement(pieces) {
  let out = [];
  for (let r = 8; r >= 1; r--) {
    let row = "", n = 0;
    for (const f of FILES) {
      const p = pieces[f + r];
      if (!p) { n++; continue; }
      if (n) { row += n; n = 0; }
      row += p.color === "w" ? p.type.toUpperCase() : p.type;
    }
    out.push(row + (n || ""));
  }
  return out.join("/");
}

// Abre o editor com a posição `fen`; devolve o FEN normalizado ou null se cancelou.
export function openEditor(fen, opt = {}) {
  return new Promise((resolve) => {
    let pieces = {}, turn = "w", castle = { K: 0, Q: 0, k: 0, q: 0 }, ep = "", orient = "w";
    let tool = { kind: "move" };
    let drag = null;

    const load = (f) => {
      const parts = f.trim().split(/\s+/);
      if (!parts[0] || parts[0].split("/").length !== 8) throw new Error("FEN inválido.");
      pieces = parseFen(parts[0]);
      turn = parts[1] === "b" ? "b" : "w";
      const c = parts[2] || "-";
      castle = { K: +c.includes("K"), Q: +c.includes("Q"), k: +c.includes("k"), q: +c.includes("q") };
      ep = parts[3] && parts[3] !== "-" ? parts[3][0] : "";
    };
    try { load(fen); } catch { load(START); }

    const d = document.createElement("dialog");
    d.className = "edit";
    d.innerHTML = `<b>Editor de posição</b>
      <div class="edwrap">
        <div class="edleft">
          <div class="edpal" data-c="b"></div>
          <div class="edboard bgrid" id="edB"></div>
          <div class="edpal" data-c="w"></div>
        </div>
        <div class="edright">
          <div class="row2"><button class="ghost" data-t="move">Mover</button><button class="ghost" data-t="del">Apagar</button></div>
          <div class="row2"><button class="ghost" id="edInit">Posição inicial</button><button class="ghost" id="edClear">Limpar</button></div>
          <div class="row2"><button class="ghost" id="edFlip">Inverter tabuleiro</button><button class="ghost" id="edMirror">Trocar cores</button></div>
          <label>Vez de jogar</label>
          <div class="row2"><label class="sw"><input type="radio" name="edTurn" value="w"> Brancas</label><label class="sw"><input type="radio" name="edTurn" value="b"> Pretas</label></div>
          <label>Roques</label>
          <div class="edcast"><label class="sw"><input type="checkbox" data-c="K"> O-O (B)</label><label class="sw"><input type="checkbox" data-c="Q"> O-O-O (B)</label><label class="sw"><input type="checkbox" data-c="k"> O-O (P)</label><label class="sw"><input type="checkbox" data-c="q"> O-O-O (P)</label></div>
          <label>En passant (coluna)</label>
          <select id="edEp"></select>
          <label>FEN</label>
          <input type="text" id="edFen" spellcheck="false">
          <div class="engmsg" id="edMsg"></div>
          <div class="row"><button id="edOk">Usar posição</button><button class="ghost" id="edNo">Cancelar</button></div>
        </div>
      </div>`;
    document.body.appendChild(d);
    const q = (s) => d.querySelector(s);
    const boardEl = q("#edB");

    // paletas
    for (const pal of d.querySelectorAll(".edpal")) {
      const c = pal.dataset.c;
      pal.innerHTML = TYPES.map((t) => `<div class="pp" data-p="${c}${t}">${pieceHtml(c, t)}</div>`).join("");
    }

    const castleOk = () => ({
      K: pieces.e1?.type === "k" && pieces.e1.color === "w" && pieces.h1?.type === "r" && pieces.h1.color === "w",
      Q: pieces.e1?.type === "k" && pieces.e1.color === "w" && pieces.a1?.type === "r" && pieces.a1.color === "w",
      k: pieces.e8?.type === "k" && pieces.e8.color === "b" && pieces.h8?.type === "r" && pieces.h8.color === "b",
      q: pieces.e8?.type === "k" && pieces.e8.color === "b" && pieces.a8?.type === "r" && pieces.a8.color === "b",
    });
    const epSquare = () => (ep ? ep + (turn === "w" ? "6" : "3") : "-");
    const curFen = () => {
      const ok = castleOk();
      let c = "";
      for (const k of ["K", "Q", "k", "q"]) if (castle[k] && ok[k]) c += k;
      return `${toPlacement(pieces)} ${turn} ${c || "-"} ${epSquare()} 0 1`;
    };

    const renderBoard = () => {
      let h = "";
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const file = orient === "w" ? c : 7 - c, rank = orient === "w" ? 7 - r : r;
        const sq = FILES[file] + (rank + 1), pc = pieces[sq];
        h += `<div class="sq ${(file + rank) % 2 === 0 ? "dark" : "light"}" data-sq="${sq}">` +
          (c === 0 ? `<span class="co r">${rank + 1}</span>` : "") + (r === 7 ? `<span class="co f">${FILES[file]}</span>` : "") +
          (pc ? pieceHtml(pc.color, pc.type, drag?.from === sq ? "ghost" : "") : "") + `</div>`;
      }
      boardEl.innerHTML = h;
    };
    const sync = (fromField = false) => {
      renderBoard();
      const ok = castleOk();
      for (const k of ["K", "Q", "k", "q"]) {
        const cb = q(`[data-c="${k}"]`);
        cb.disabled = !ok[k];
        cb.checked = !!(castle[k] && ok[k]);
      }
      // en passant: só colunas onde existe peão adversário que acabou de avançar duas casas
      const opts = [`<option value="">—</option>`];
      const pawnRank = turn === "w" ? "5" : "4", color = turn === "w" ? "b" : "w";
      for (const f of FILES) if (pieces[f + pawnRank]?.type === "p" && pieces[f + pawnRank].color === color) opts.push(`<option value="${f}">${f}</option>`);
      q("#edEp").innerHTML = opts.join("");
      if (!opts.some((o) => o.includes(`value="${ep}"`))) ep = "";
      q("#edEp").value = ep;
      for (const r of d.querySelectorAll('[name="edTurn"]')) r.checked = r.value === turn;
      if (!fromField) q("#edFen").value = curFen();
      for (const b of d.querySelectorAll("[data-t]")) b.classList.toggle("on", tool.kind === b.dataset.t);
      for (const p of d.querySelectorAll(".pp")) p.classList.toggle("on", tool.kind === "put" && tool.p === p.dataset.p);
      boardEl.style.cursor = tool.kind === "del" ? "not-allowed" : "";
    };

    const sqAt = (e) => {
      const r = boardEl.getBoundingClientRect();
      const c = Math.floor(((e.clientX - r.left) / r.width) * 8), rw = Math.floor(((e.clientY - r.top) / r.height) * 8);
      if (c < 0 || c > 7 || rw < 0 || rw > 7) return null;
      const file = orient === "w" ? c : 7 - c, rank = orient === "w" ? 7 - rw : rw;
      return FILES[file] + (rank + 1);
    };
    const ghostAt = (e, p) => {
      if (!drag.ghost) {
        const t = document.createElement("div");
        t.innerHTML = pieceHtml(p.color, p.type, "floating");
        drag.ghost = t.firstElementChild;
        document.body.appendChild(drag.ghost);
      }
      drag.ghost.style.left = e.clientX + "px"; drag.ghost.style.top = e.clientY + "px";
    };
    const putAt = (sq) => {
      if (!sq) return;
      if (tool.kind === "del") delete pieces[sq];
      else if (tool.kind === "put") {
        // o rei é único: ao colocar um, o anterior some
        if (tool.p[1] === "k") for (const s of Object.keys(pieces)) if (pieces[s].type === "k" && pieces[s].color === tool.p[0]) delete pieces[s];
        pieces[sq] = { color: tool.p[0], type: tool.p[1] };
      }
    };

    boardEl.addEventListener("contextmenu", (e) => e.preventDefault());
    boardEl.addEventListener("pointerdown", (e) => {
      const sq = sqAt(e);
      if (!sq) return;
      if (e.button === 2) { delete pieces[sq]; sync(); return; }
      if (e.button !== 0) return;
      if (tool.kind === "move") {
        const pc = pieces[sq];
        if (!pc) return;
        drag = { from: sq, piece: pc };
        ghostAt(e, pc); renderBoard();
      } else { drag = { paint: true, last: sq }; putAt(sq); sync(); }
    });
    d.querySelector(".edleft").addEventListener("pointerdown", (e) => {
      const pp = e.target.closest(".pp");
      if (!pp || e.button !== 0) return;
      tool = { kind: "put", p: pp.dataset.p };
      drag = { fromPalette: true, piece: { color: pp.dataset.p[0], type: pp.dataset.p[1] } };
      ghostAt(e, drag.piece); sync();
    });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    function onMove(e) {
      if (!drag) return;
      if (drag.ghost) { drag.ghost.style.left = e.clientX + "px"; drag.ghost.style.top = e.clientY + "px"; }
      if (drag.paint) { const sq = sqAt(e); if (sq && sq !== drag.last) { drag.last = sq; putAt(sq); sync(); } }
    }
    function onUp(e) {
      if (!drag) return;
      const dr = drag; drag = null;
      dr.ghost?.remove();
      const sq = sqAt(e);
      if (dr.from) {
        if (!sq) delete pieces[dr.from];                       // soltou fora do tabuleiro: apaga
        else if (sq !== dr.from) { pieces[sq] = dr.piece; delete pieces[dr.from]; }
      } else if (dr.fromPalette && sq) {
        const keep = tool; putAt(sq); tool = keep;
        // arrastou da paleta e soltou: volta para "mover" como no Lichess
        tool = { kind: "move" };
      }
      sync();
    }

    d.addEventListener("click", (e) => {
      const t = e.target.closest("[data-t]");
      if (t) { tool = { kind: t.dataset.t }; sync(); }
    });
    q("#edInit").onclick = () => { load(START); sync(); };
    q("#edClear").onclick = () => { load(EMPTY); sync(); };
    q("#edFlip").onclick = () => { orient = orient === "w" ? "b" : "w"; sync(); };
    q("#edMirror").onclick = () => {
      const m = {};
      for (const [s, p] of Object.entries(pieces)) m[s] = { color: p.color === "w" ? "b" : "w", type: p.type };
      pieces = m; turn = turn === "w" ? "b" : "w"; castle = { K: castle.k, Q: castle.q, k: castle.K, q: castle.Q }; ep = "";
      sync();
    };
    for (const r of d.querySelectorAll('[name="edTurn"]')) r.onchange = () => { turn = r.value; sync(); };
    for (const cb of d.querySelectorAll(".edcast [data-c]")) cb.onchange = () => { castle[cb.dataset.c] = +cb.checked; sync(); };
    q("#edEp").onchange = (e) => { ep = e.target.value; sync(); };
    const fromField = () => {
      try { load(q("#edFen").value); q("#edMsg").textContent = ""; sync(); }
      catch (err) { q("#edMsg").textContent = "FEN inválido."; }
    };
    q("#edFen").onchange = fromField;
    q("#edFen").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); fromField(); } };

    const validate = () => {
      const f = curFen();
      const kings = { w: 0, b: 0 };
      for (const [s, p] of Object.entries(pieces)) {
        if (p.type === "k") kings[p.color]++;
        if (p.type === "p" && (s[1] === "1" || s[1] === "8")) return "Peões não podem ficar na 1ª nem na 8ª fileira.";
      }
      if (opt.pattern) return "";
      if (kings.w !== 1 || kings.b !== 1) return "A posição precisa de exatamente um rei de cada cor.";
      let c;
      try { c = new Chess(f); } catch { return "Posição inválida."; }
      try {
        const other = new Chess(f.replace(` ${turn} `, ` ${turn === "w" ? "b" : "w"} `).replace(/ [a-h][36] /, " - "));
        if (other.isCheck()) return "O rei de quem não tem a vez está em xeque — posição ilegal.";
      } catch { /* ignora: a validação principal já passou */ }
      return "";
    };

    let result = null;
    q("#edOk").onclick = () => {
      const err = validate();
      if (err) { q("#edMsg").textContent = err; return; }
      result = opt.pattern ? curFen() : new Chess(curFen()).fen();
      d.close();
    };
    q("#edNo").onclick = () => d.close();
    d.addEventListener("close", () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      d.remove(); resolve(result);
    });
    d.showModal();
    sync();
  });
}
