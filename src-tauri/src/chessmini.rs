// Mini xadrez só para o explorador: aplica lances em SAN a partir da posição inicial e calcula um hash da posição
// (peças, vez e roques; o en passant não entra). Não gera lances para jogar: só resolve o SAN que já existe no PGN.
use std::sync::OnceLock;

// peça: 0 vazio; 1..=6 = P N B R Q K brancas; 9..=14 = pretas (bit 3 = preta)
const P: u8 = 1; const N: u8 = 2; const B: u8 = 3; const R: u8 = 4; const Q: u8 = 5; const K: u8 = 6;

#[derive(Clone)]
pub struct Pos { b: [u8; 64], white: bool, castle: u8, ep: i8 } // castle: 1=K 2=Q (brancas) 4=k 8=q (pretas); ep = casa alvo ou -1

fn zob() -> &'static ([[u64; 64]; 16], [u64; 16], u64) {
    static Z: OnceLock<([[u64; 64]; 16], [u64; 16], u64)> = OnceLock::new();
    Z.get_or_init(|| {
        let mut s: u64 = 0x9E3779B97F4A7C15;
        let mut next = || { s = s.wrapping_add(0x9E3779B97F4A7C15); let mut z = s; z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9); z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB); z ^ (z >> 31) };
        let mut ps = [[0u64; 64]; 16];
        for p in ps.iter_mut() { for q in p.iter_mut() { *q = next(); } }
        let mut cs = [0u64; 16];
        for c in cs.iter_mut() { *c = next(); }
        (ps, cs, next())
    })
}

const fn file(sq: usize) -> i32 { (sq % 8) as i32 }
const fn rank(sq: usize) -> i32 { (sq / 8) as i32 }
fn sq_of(f: i32, r: i32) -> Option<usize> { if (0..8).contains(&f) && (0..8).contains(&r) { Some((r * 8 + f) as usize) } else { None } }

impl Pos {
    pub fn start() -> Pos {
        let mut b = [0u8; 64];
        let back = [R, N, B, Q, K, B, N, R];
        for f in 0..8 { b[f] = back[f]; b[8 + f] = P; b[48 + f] = P | 8; b[56 + f] = back[f] | 8; }
        Pos { b, white: true, castle: 15, ep: -1 }
    }
    pub fn hash(&self) -> u32 {
        let (ps, cs, t) = zob();
        let mut h = cs[self.castle as usize];
        if self.white { h ^= t; }
        for (i, &p) in self.b.iter().enumerate() { if p != 0 { h ^= ps[p as usize][i]; } }
        let v = (h ^ (h >> 32)) as u32;
        if v == 0 { 1 } else { v }
    }
    // lê o FEN (só colocação, vez e roques bastam)
    pub fn from_fen(fen: &str) -> Option<Pos> {
        let mut it = fen.split_whitespace();
        let rows: Vec<&str> = it.next()?.split('/').collect();
        if rows.len() != 8 { return None; }
        let mut b = [0u8; 64];
        for (i, row) in rows.iter().enumerate() {
            let r = 7 - i; let mut f = 0usize;
            for ch in row.chars() {
                if let Some(d) = ch.to_digit(10) { f += d as usize; continue; }
                let p = match ch.to_ascii_lowercase() { 'p' => P, 'n' => N, 'b' => B, 'r' => R, 'q' => Q, 'k' => K, _ => return None };
                if f > 7 { return None; }
                b[r * 8 + f] = if ch.is_ascii_lowercase() { p | 8 } else { p };
                f += 1;
            }
            if f != 8 { return None; }
        }
        let white = it.next().map(|t| t != "b").unwrap_or(true);
        Some(Pos { b, white, castle: 0, ep: -1 })
    }
    // Compara só a colocação das peças (vez e roques ignorados).
    // exact: idêntica; senão, todas as peças de `t` precisam estar nas mesmas casas (a posição pode ter mais).
    pub fn matches(&self, t: &Pos, exact: bool) -> bool {
        if exact { return self.b == t.b; }
        for i in 0..64 { if t.b[i] != 0 && self.b[i] != t.b[i] { return false; } }
        true
    }
    fn mine(&self, p: u8) -> bool { p != 0 && ((p & 8 != 0) != self.white) }
    // a casa `sq` é atacada por peças da cor `by_white`?
    fn attacked(&self, sq: usize, by_white: bool) -> bool {
        let col = if by_white { 0u8 } else { 8u8 };
        let (f, r) = (file(sq), rank(sq));
        let at = |df: i32, dr: i32| sq_of(f + df, r + dr).map(|s| self.b[s]).unwrap_or(0);
        let pdr = if by_white { -1 } else { 1 };
        for df in [-1, 1] { if at(df, pdr) == (P | col) { return true; } }
        for (df, dr) in [(1, 2), (2, 1), (-1, 2), (-2, 1), (1, -2), (2, -1), (-1, -2), (-2, -1)] { if at(df, dr) == (N | col) { return true; } }
        for df in -1..=1 { for dr in -1..=1 { if (df != 0 || dr != 0) && at(df, dr) == (K | col) { return true; } } }
        for (df, dr, diag) in [(1, 0, false), (-1, 0, false), (0, 1, false), (0, -1, false), (1, 1, true), (1, -1, true), (-1, 1, true), (-1, -1, true)] {
            let (mut x, mut y) = (f + df, r + dr);
            while let Some(s) = sq_of(x, y) {
                let p = self.b[s];
                if p != 0 {
                    if p & 8 == col & 8 && (p & 7 == Q || p & 7 == if diag { B } else { R }) { return true; }
                    break;
                }
                x += df; y += dr;
            }
        }
        false
    }
    fn king_sq(&self, white: bool) -> Option<usize> { let k = K | if white { 0 } else { 8 }; self.b.iter().position(|&p| p == k) }
    // caminho livre entre duas casas em linha reta/diagonal (exclusive)
    fn clear(&self, from: usize, to: usize) -> bool {
        let (df, dr) = ((file(to) - file(from)).signum(), (rank(to) - rank(from)).signum());
        let (mut x, mut y) = (file(from) + df, rank(from) + dr);
        while (x, y) != (file(to), rank(to)) { if self.b[(y * 8 + x) as usize] != 0 { return false; } x += df; y += dr; }
        true
    }
    fn reaches(&self, from: usize, to: usize, t: u8) -> bool {
        let (df, dr) = (file(to) - file(from), rank(to) - rank(from));
        match t {
            N => (df.abs() == 1 && dr.abs() == 2) || (df.abs() == 2 && dr.abs() == 1),
            K => df.abs() <= 1 && dr.abs() <= 1 && (df != 0 || dr != 0),
            B => df.abs() == dr.abs() && df != 0 && self.clear(from, to),
            R => (df == 0) != (dr == 0) && self.clear(from, to),
            Q => ((df.abs() == dr.abs() && df != 0) || ((df == 0) != (dr == 0))) && self.clear(from, to),
            _ => false,
        }
    }
    // joga from→to (já escolhido); `promo` = tipo da promoção (0 = nenhuma)
    fn do_move(&mut self, from: usize, to: usize, promo: u8) {
        let p = self.b[from];
        let col = p & 8;
        let t = p & 7;
        let target = self.b[to];
        self.b[from] = 0;
        let mut ep = -1i8;
        if t == P {
            if target == 0 && file(from) != file(to) { // en passant
                let cap = if col == 0 { to - 8 } else { to + 8 };
                self.b[cap] = 0;
            }
            if (rank(to) - rank(from)).abs() == 2 { ep = ((from + to) / 2) as i8; }
        }
        self.b[to] = if promo != 0 { promo | col } else { p };
        if t == K {
            if col == 0 { self.castle &= !3; } else { self.castle &= !12; }
            if (file(to) - file(from)).abs() == 2 { // roque: move a torre
                let r = rank(from);
                let (rf, rt) = if file(to) > file(from) { (7, 5) } else { (0, 3) };
                let (a, b2) = ((r * 8 + rf) as usize, (r * 8 + rt) as usize);
                self.b[b2] = self.b[a];
                self.b[a] = 0;
            }
        }
        for sq in [from, to] { match sq { 0 => self.castle &= !2, 7 => self.castle &= !1, 56 => self.castle &= !8, 63 => self.castle &= !4, _ => {} } }
        self.ep = ep;
        self.white = !self.white;
    }
    fn legal_after(&self, from: usize, to: usize) -> bool {
        let mut c = self.clone();
        let me = c.white;
        c.do_move(from, to, 0);
        match c.king_sq(me) { Some(k) => !c.attacked(k, !me), None => false }
    }
    // Aplica um lance em SAN (sem anotações). false se o lance não existe na posição.
    pub fn apply_san(&mut self, san: &str) -> bool {
        let s = san.trim_end_matches(|c| c == '+' || c == '#' || c == '!' || c == '?');
        let rk = if self.white { 0 } else { 7 };
        if matches!(s, "O-O" | "0-0" | "O-O-O" | "0-0-0") {
            let long = s.len() > 3;
            let (from, to) = ((rk * 8 + 4) as usize, (rk * 8 + if long { 2 } else { 6 }) as usize);
            if self.b[from] != (K | if self.white { 0 } else { 8 }) { return false; }
            self.do_move(from, to, 0);
            return true;
        }
        let bytes: Vec<u8> = s.bytes().filter(|&c| c != b'x' && c != b'-').collect();
        if bytes.len() < 2 { return false; }
        let (piece, mut body) = match bytes[0] { b'K' => (K, &bytes[1..]), b'Q' => (Q, &bytes[1..]), b'R' => (R, &bytes[1..]), b'B' => (B, &bytes[1..]), b'N' => (N, &bytes[1..]), _ => (P, &bytes[..]) };
        let mut promo = 0u8;
        // promoção: "=Q" ou "Q" no fim
        if body.len() >= 3 {
            let l = body[body.len() - 1];
            let pr = match l { b'Q' => Q, b'R' => R, b'B' => B, b'N' => N, _ => 0 };
            if pr != 0 { promo = pr; body = &body[..body.len() - 1]; if body.last() == Some(&b'=') { body = &body[..body.len() - 1]; } }
        }
        if body.len() < 2 { return false; }
        let (df, dr) = (body[body.len() - 2], body[body.len() - 1]);
        if !(b'a'..=b'h').contains(&df) || !(b'1'..=b'8').contains(&dr) { return false; }
        let to = ((dr - b'1') as usize) * 8 + (df - b'a') as usize;
        let dis = &body[..body.len() - 2];
        let (mut dfile, mut drank) = (-1i32, -1i32);
        for &c in dis { if (b'a'..=b'h').contains(&c) { dfile = (c - b'a') as i32; } else if (b'1'..=b'8').contains(&c) { drank = (c - b'1') as i32; } }
        let col = if self.white { 0u8 } else { 8u8 };
        if self.b[to] != 0 && self.mine(self.b[to]) { return false; }
        let mut cands: Vec<usize> = Vec::new();
        if piece == P {
            let dir: i32 = if self.white { 1 } else { -1 };
            let capture = dfile >= 0; // peão que captura traz a coluna de origem
            if capture {
                if let Some(from) = sq_of(dfile, rank(to) - dir) { if self.b[from] == (P | col) && (file(to) - dfile).abs() == 1 { cands.push(from); } }
            } else if let Some(f1) = sq_of(file(to), rank(to) - dir) {
                if self.b[f1] == (P | col) { cands.push(f1); }
                else if self.b[f1] == 0 && rank(to) == (if self.white { 3 } else { 4 }) {
                    if let Some(f2) = sq_of(file(to), rank(to) - 2 * dir) { if self.b[f2] == (P | col) && self.b[to] == 0 { cands.push(f2); } }
                }
            }
        } else {
            for from in 0..64 {
                if self.b[from] != (piece | col) { continue; }
                if dfile >= 0 && file(from) != dfile { continue; }
                if drank >= 0 && rank(from) != drank { continue; }
                if self.reaches(from, to, piece) { cands.push(from); }
            }
            if cands.len() > 1 { cands.retain(|&f| self.legal_after(f, to)); }
        }
        if cands.len() != 1 { return false; }
        self.do_move(cands[0], to, promo);
        true
    }
}
