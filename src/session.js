import { Chess } from "./vendor/chess.js";

// Lógica de um puzzle (sem interface): valida lances, responde pelo adversário, dicas.
export class PuzzleSession {
  constructor(p) {
    this.p = p;
    this.game = new Chess(p.fen);
    this.orient = this.game.turn(); // 'w' ou 'b': cor de quem resolve
    this.idx = 0;
    this.failed = false;
    this.solved = false;
    this.shown = false;
    this.lastMove = null;
    this.hintStep = 0;
  }
  get canMove() { return !this.solved && this.game.turn() === this.orient; }
  targets(sq) { return this.game.moves({ square: sq, verbose: true }); }
  needsPromotion(from, to) { return this.targets(from).some((m) => m.to === to && m.promotion); }
  isLegal(from, to) { return this.targets(from).some((m) => m.to === to); }

  tryMove(from, to, promo = "") {
    const exp = this.p.moves[this.idx];
    this.game.move({ from, to, promotion: promo || undefined });
    const ok = (exp.f === from && exp.t === to && (exp.p || "") === promo) || this.game.isCheckmate();
    if (!ok) {
      this.game.undo();
      this.failed = true;
      return { status: "wrong" };
    }
    this.lastMove = { from, to };
    this.idx++;
    this.hintStep = 0;
    if (this.idx >= this.p.moves.length || this.game.isCheckmate()) {
      this.solved = true;
      return { status: "solved", note: exp.c };
    }
    return { status: "right", note: exp.c };
  }
  playNext() { // joga o próximo lance da solução (resposta do adversário ou revelação)
    const r = this.p.moves[this.idx];
    this.game.move({ from: r.f, to: r.t, promotion: r.p || undefined });
    this.lastMove = { from: r.f, to: r.t };
    this.idx++;
    if (this.idx >= this.p.moves.length) this.solved = true;
    return r;
  }
  hint() {
    if (!this.canMove) return null;
    const e = this.p.moves[this.idx];
    this.hintStep = (this.hintStep % 3) + 1;
    return { step: this.hintStep, from: e.f, to: e.t };
  }
  explanation() {
    const parts = this.p.fen.split(" ");
    let white = parts[1] === "w";
    let n = parseInt(parts[5], 10) || 1;
    const out = [];
    this.p.moves.forEach((m, i) => {
      const label = white ? `${n}.` : i === 0 ? `${n}...` : "";
      out.push({ label, san: m.san, c: m.c });
      if (!white) n++;
      white = !white;
    });
    return out;
  }
}
