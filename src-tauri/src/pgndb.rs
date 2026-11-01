// Bases de dados PGN grandes: lê o arquivo em streaming (sem carregá-lo na memória) e grava um índice binário
// compacto ao lado. O PGN original continua no lugar; para abrir uma partida o app lê só o trecho dela.
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use crate::chessmini::Pos;
use tauri::{AppHandle, Emitter};

const REC: usize = 28; // offset u64 | len u32 | branco u32 | preto u32 | ano u16 | elo B u16 | elo P u16 | resultado u8 | 0
static CANCEL: AtomicBool = AtomicBool::new(false);
static NAMES: Mutex<Option<(String, Arc<Vec<String>>)>> = Mutex::new(None);

#[derive(Serialize, Deserialize, Clone)]
pub struct DbMeta {
    id: String,
    name: String,
    source: String,
    games: u64,
    size: u64,
    added: u64,
    #[serde(default)]
    explorer: bool,
}

fn dbs_dir() -> PathBuf {
    let p = crate::lib_dir().join(".databases");
    let _ = fs::create_dir_all(&p);
    p
}
fn valid_id(id: &str) -> bool { !id.is_empty() && id.len() < 40 && id.chars().all(|c| c.is_ascii_alphanumeric()) }
fn db_dir(id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) { return Err("id inválido".into()); }
    Ok(dbs_dir().join(id))
}
fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

fn intern(map: &mut HashMap<String, u32>, list: &mut Vec<String>, s: &str) -> u32 {
    if let Some(&i) = map.get(s) { return i; }
    let i = list.len() as u32;
    list.push(s.to_string());
    map.insert(s.to_string(), i);
    i
}

#[derive(Default)]
struct G {
    start: u64,
    white: String,
    black: String,
    year: u16,
    welo: u16,
    belo: u16,
    result: u8,
}


const K: usize = 30; // plies guardados por partida para o explorador
#[derive(Default)]
struct Mv { in_c: bool, depth: u32, tok: Vec<u8>, ids: Vec<u16> }
fn norm_san(t: &str) -> &str { t.trim_end_matches(|c| c == '+' || c == '#' || c == '!' || c == '?') }
impl Mv {
    fn reset(&mut self) { self.in_c = false; self.depth = 0; self.tok.clear(); self.ids.clear(); }
    fn feed(&mut self, line: &[u8], map: &mut HashMap<String, u16>, sans: &mut Vec<String>) {
        for &c in line {
            if self.ids.len() >= K { return; }
            if self.in_c { if c == b'}' { self.in_c = false; } continue; }
            match c {
                b'{' => { self.flush(map, sans); self.in_c = true; }
                b';' => { self.flush(map, sans); return; }
                b'(' => { self.flush(map, sans); self.depth += 1; }
                b')' => { self.flush(map, sans); self.depth = self.depth.saturating_sub(1); }
                b' ' | b'\t' | b'\r' | b'\n' => self.flush(map, sans),
                _ => { if self.depth == 0 { self.tok.push(c); } }
            }
        }
        self.flush(map, sans);
    }
    fn flush(&mut self, map: &mut HashMap<String, u16>, sans: &mut Vec<String>) {
        if self.tok.is_empty() { return; }
        let tok = std::mem::take(&mut self.tok);
        let b = &tok[..];
        let mut i = 0;
        while i < b.len() && b[i].is_ascii_digit() { i += 1; }
        let rest: &[u8] = if i > 0 {
            if i < b.len() && b[i] == b'.' { while i < b.len() && b[i] == b'.' { i += 1; } &b[i..] } else { &[] } // resultado ou número solto
        } else { b };
        if rest.is_empty() || rest[0] == b'$' || rest[0] == b'*' { self.tok = tok; self.tok.clear(); return; }
        if let Ok(t) = std::str::from_utf8(rest) {
            let t = norm_san(t);
            if !t.is_empty() && b"KQRBNOabcdefgh".contains(&t.as_bytes()[0]) {
                let id = match map.get(t) {
                    Some(&v) => v,
                    None => {
                        if sans.len() >= 65534 { 65535 } else { sans.push(t.to_string()); let v = sans.len() as u16; map.insert(t.to_string(), v); v }
                    }
                };
                self.ids.push(id);
            }
        }
        self.tok = tok;
        self.tok.clear();
    }
}

fn write_rec(out: &mut BufWriter<File>, mout: &mut BufWriter<File>, pout: &mut BufWriter<File>, mv: &Mv, sans: &[String], g: &G, end: u64, map: &mut HashMap<String, u32>, list: &mut Vec<String>) -> std::io::Result<()> {
    for i in 0..K { let v: u16 = mv.ids.get(i).copied().unwrap_or(0); mout.write_all(&v.to_le_bytes())?; }
    // hash da posição depois de cada lance (0 = sem dado): permite achar a mesma posição por outra ordem de lances
    let mut pos = Pos::start();
    let mut alive = true;
    for i in 0..K {
        let mut h = 0u32;
        if alive {
            let id = mv.ids.get(i).copied().unwrap_or(0);
            match (id, sans.get((id as usize).wrapping_sub(1))) {
                (id, Some(s)) if id != 0 && id != 65535 && pos.apply_san(s) => h = pos.hash(),
                _ => alive = false,
            }
        }
        pout.write_all(&h.to_le_bytes())?;
    }
    let w = intern(map, list, &g.white);
    let b = intern(map, list, &g.black);
    let len = (end - g.start).min(u32::MAX as u64) as u32;
    out.write_all(&g.start.to_le_bytes())?;
    out.write_all(&len.to_le_bytes())?;
    out.write_all(&w.to_le_bytes())?;
    out.write_all(&b.to_le_bytes())?;
    out.write_all(&g.year.to_le_bytes())?;
    out.write_all(&g.welo.to_le_bytes())?;
    out.write_all(&g.belo.to_le_bytes())?;
    out.write_all(&[g.result, 0u8])
}

fn tag_of(line: &[u8]) -> Option<(String, String)> {
    let s = String::from_utf8_lossy(line);
    let s = s.trim();
    let inner = s.strip_prefix('[')?.strip_suffix(']')?;
    let sp = inner.find(' ')?;
    let key = inner[..sp].to_string();
    let rest = inner[sp + 1..].trim();
    let val = rest.strip_prefix('"')?.strip_suffix('"').unwrap_or(rest.trim_matches('"'));
    Some((key, val.to_string()))
}

fn run_import(app: &AppHandle, src: &PathBuf, dir: &PathBuf, id: &str, name: &str, size: u64) -> Result<u64, String> {
    let f = File::open(src).map_err(|e| format!("Não consegui abrir o arquivo: {e}"))?;
    let mut rd = BufReader::with_capacity(1 << 20, f);
    let mut out = BufWriter::with_capacity(1 << 20, File::create(dir.join("games.bin")).map_err(|e| e.to_string())?);
    let mut map: HashMap<String, u32> = HashMap::new();
    let mut list: Vec<String> = Vec::new();
    let mut mout = BufWriter::with_capacity(1 << 20, File::create(dir.join("moves.bin")).map_err(|e| e.to_string())?);
    let mut pout = BufWriter::with_capacity(1 << 20, File::create(dir.join("pos.bin")).map_err(|e| e.to_string())?);
    let mut smap: HashMap<String, u16> = HashMap::new();
    let mut sans: Vec<String> = Vec::new();
    let mut mv = Mv::default();
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut pos: u64 = 0;
    let mut cur: Option<G> = None;
    let mut n: u64 = 0;
    let mut last = Instant::now();
    loop {
        buf.clear();
        let r = rd.read_until(b'\n', &mut buf).map_err(|e| e.to_string())?;
        if r == 0 { break; }
        let line_start = pos;
        pos += r as u64;
        let l: &[u8] = if line_start == 0 && buf.starts_with(&[0xEF, 0xBB, 0xBF]) { &buf[3..] } else { &buf[..] };
        if l.starts_with(b"[Event ") {
            if let Some(g) = cur.take() { write_rec(&mut out, &mut mout, &mut pout, &mv, &sans, &g, line_start, &mut map, &mut list).map_err(|e| e.to_string())?; n += 1; }
            mv.reset();
            let mut g = G::default();
            g.start = line_start;
            g.white = "?".into();
            g.black = "?".into();
            cur = Some(g);
            if last.elapsed() > Duration::from_millis(150) {
                last = Instant::now();
                if CANCEL.load(Ordering::Relaxed) { return Err("cancelado".into()); }
                let _ = app.emit("db-progress", json!({ "id": id, "done": pos, "total": size, "games": n }));
            }
        } else if !l.starts_with(b"[") {
            if cur.is_some() { mv.feed(l, &mut smap, &mut sans); }
        } else {
            if let Some(g) = cur.as_mut() {
                if let Some((k, v)) = tag_of(l) {
                    match k.as_str() {
                        "White" => g.white = v,
                        "Black" => g.black = v,
                        "Result" => g.result = match v.as_str() { "1-0" => 1, "0-1" => 2, "1/2-1/2" => 3, _ => 0 },
                        "Date" | "UTCDate" => { if g.year == 0 { g.year = v.get(0..4).and_then(|y| y.parse().ok()).unwrap_or(0); } }
                        "WhiteElo" => g.welo = v.parse().unwrap_or(0),
                        "BlackElo" => g.belo = v.parse().unwrap_or(0),
                        _ => {}
                    }
                }
            }
        }
    }
    if let Some(g) = cur.take() { write_rec(&mut out, &mut mout, &mut pout, &mv, &sans, &g, pos, &mut map, &mut list).map_err(|e| e.to_string())?; n += 1; }
    out.flush().map_err(|e| e.to_string())?;
    mout.flush().map_err(|e| e.to_string())?;
    pout.flush().map_err(|e| e.to_string())?;
    fs::write(dir.join("san.txt"), sans.join("\n")).map_err(|e| e.to_string())?;
    let mut nm = BufWriter::new(File::create(dir.join("names.txt")).map_err(|e| e.to_string())?);
    for s in &list { nm.write_all(s.replace('\n', " ").as_bytes()).map_err(|e| e.to_string())?; nm.write_all(b"\n").map_err(|e| e.to_string())?; }
    nm.flush().map_err(|e| e.to_string())?;
    let meta = DbMeta { id: id.to_string(), name: name.to_string(), source: src.to_string_lossy().to_string(), games: n, size, added: now_ms(), explorer: true };
    fs::write(dir.join("meta.json"), serde_json::to_string(&meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(n)
}

// Começa a importar em segundo plano; o progresso chega pelos eventos "db-progress" e "db-done".
#[tauri::command]
pub fn db_import(app: AppHandle, path: String, name: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    let size = fs::metadata(&src).map_err(|e| format!("Arquivo não encontrado: {e}"))?.len();
    let id = format!("db{}", now_ms());
    let dir = dbs_dir().join(&id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    CANCEL.store(false, Ordering::Relaxed);
    let id2 = id.clone();
    std::thread::spawn(move || {
        match run_import(&app, &src, &dir, &id2, &name, size) {
            Ok(n) => { let _ = app.emit("db-done", json!({ "id": id2, "ok": true, "games": n })); }
            Err(e) => { let _ = fs::remove_dir_all(&dir); let _ = app.emit("db-done", json!({ "id": id2, "ok": false, "error": e })); }
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn db_cancel() { CANCEL.store(true, Ordering::Relaxed); }

#[tauri::command]
pub fn db_list() -> Vec<DbMeta> {
    let mut v: Vec<DbMeta> = Vec::new();
    if let Ok(rd) = fs::read_dir(dbs_dir()) {
        for e in rd.flatten() {
            if let Ok(t) = fs::read_to_string(e.path().join("meta.json")) {
                if let Ok(m) = serde_json::from_str::<DbMeta>(&t) { v.push(m); }
            }
        }
    }
    v.sort_by(|a, b| b.added.cmp(&a.added));
    v
}

#[tauri::command]
pub fn db_delete(id: String) -> Result<(), String> {
    let d = db_dir(&id)?;
    if let Ok(mut g) = NAMES.lock() { *g = None; }
    fs::remove_dir_all(d).map_err(|e| e.to_string())
}

fn names_of(id: &str) -> Result<Arc<Vec<String>>, String> {
    if let Ok(g) = NAMES.lock() {
        if let Some((cid, v)) = g.as_ref() { if cid == id { return Ok(v.clone()); } }
    }
    let t = fs::read_to_string(db_dir(id)?.join("names.txt")).map_err(|e| e.to_string())?;
    let v: Arc<Vec<String>> = Arc::new(t.lines().map(|s| s.to_string()).collect());
    if let Ok(mut g) = NAMES.lock() { *g = Some((id.to_string(), v.clone())); }
    Ok(v)
}

#[derive(Clone, Copy)]
struct Rec { off: u64, len: u32, w: u32, b: u32, year: u16, welo: u16, belo: u16, result: u8 }
fn rec_of(b: &[u8]) -> Rec {
    let u64_ = |i: usize| u64::from_le_bytes(b[i..i + 8].try_into().unwrap());
    let u32_ = |i: usize| u32::from_le_bytes(b[i..i + 4].try_into().unwrap());
    let u16_ = |i: usize| u16::from_le_bytes(b[i..i + 2].try_into().unwrap());
    Rec { off: u64_(0), len: u32_(8), w: u32_(12), b: u32_(16), year: u16_(20), welo: u16_(22), belo: u16_(24), result: b[26] }
}

#[derive(Serialize)]
pub struct Row { i: u64, white: String, black: String, welo: u16, belo: u16, result: String, year: u16 }
#[derive(Serialize)]
pub struct Page { rows: Vec<Row>, more: bool }

#[tauri::command(async)]
pub fn db_page(id: String, offset: u64, limit: u64, player: String, side: String, result: String, year_from: u16, year_to: u16) -> Result<Page, String> {
    let dir = db_dir(&id)?;
    let names = names_of(&id)?;
    let q = player.trim().to_lowercase();
    let ids: Option<HashSet<u32>> = if q.is_empty() { None } else {
        Some(names.iter().enumerate().filter(|(_, s)| s.to_lowercase().contains(&q)).map(|(i, _)| i as u32).collect())
    };
    let res_code: Option<u8> = match result.as_str() { "1-0" => Some(1), "0-1" => Some(2), "1/2-1/2" => Some(3), _ => None };
    let filtered = ids.is_some() || res_code.is_some() || year_from > 0 || year_to > 0;
    let mut f = BufReader::with_capacity(1 << 20, File::open(dir.join("games.bin")).map_err(|e| e.to_string())?);
    let mut idx: u64 = 0;
    if !filtered { f.seek(SeekFrom::Start(offset * REC as u64)).map_err(|e| e.to_string())?; idx = offset; }
    let mut skipped: u64 = if filtered { 0 } else { offset };
    let mut rows: Vec<Row> = Vec::new();
    let mut more = false;
    let mut b = [0u8; REC];
    loop {
        if f.read_exact(&mut b).is_err() { break; }
        let r = rec_of(&b);
        let this = idx;
        idx += 1;
        if let Some(s) = &ids {
            let hit = match side.as_str() { "w" => s.contains(&r.w), "b" => s.contains(&r.b), _ => s.contains(&r.w) || s.contains(&r.b) };
            if !hit { continue; }
        }
        if let Some(c) = res_code { if r.result != c { continue; } }
        if year_from > 0 && r.year < year_from { continue; }
        if year_to > 0 && (r.year == 0 || r.year > year_to) { continue; }
        if skipped < offset { skipped += 1; continue; }
        if rows.len() as u64 >= limit { more = true; break; }
        let _ = (r.off, r.len);
        rows.push(Row {
            i: this,
            white: names.get(r.w as usize).cloned().unwrap_or_default(),
            black: names.get(r.b as usize).cloned().unwrap_or_default(),
            welo: r.welo, belo: r.belo,
            result: match r.result { 1 => "1-0", 2 => "0-1", 3 => "1/2-1/2", _ => "*" }.to_string(),
            year: r.year,
        });
    }
    Ok(Page { rows, more })
}

// Lê só o trecho da partida no PGN original.
#[tauri::command]
pub fn db_game(id: String, index: u64) -> Result<String, String> {
    let dir = db_dir(&id)?;
    let meta: DbMeta = serde_json::from_str(&fs::read_to_string(dir.join("meta.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mut f = File::open(dir.join("games.bin")).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(index * REC as u64)).map_err(|e| e.to_string())?;
    let mut b = [0u8; REC];
    f.read_exact(&mut b).map_err(|_| "Partida fora do índice".to_string())?;
    let r = rec_of(&b);
    let mut src = File::open(&meta.source).map_err(|_| format!("O arquivo original não foi encontrado: {}", meta.source))?;
    src.seek(SeekFrom::Start(r.off)).map_err(|e| e.to_string())?;
    let mut data = vec![0u8; r.len as usize];
    src.read_exact(&mut data).map_err(|e| e.to_string())?;
    let mut s = String::from_utf8_lossy(&data).to_string();
    if s.starts_with('\u{feff}') { s.remove(0); }
    Ok(s.trim().to_string())
}

// ---------- explorador de abertura ----------
#[derive(Serialize)]
pub struct MoveStat { san: String, n: u64, w: u64, d: u64, b: u64, elo: u32 }
#[derive(Serialize)]
pub struct Explore { ready: bool, beyond: bool, by_pos: bool, total: u64, moves: Vec<MoveStat>, games: Vec<Row> }

// Estatísticas dos lances seguintes a uma posição, dada como sequência de lances (SAN) a partir da posição inicial.
// Com pos.bin compara POSIÇÕES (transposições somam); databases antigas, sem pos.bin, comparam a sequência de lances.
// Vale até K lances (plies).
#[tauri::command(async)]
pub fn db_explore(id: String, moves: Vec<String>, player: String, side: String) -> Result<Explore, String> {
    let dir = db_dir(&id)?;
    let by_pos = dir.join("pos.bin").exists();
    let empty = |ready: bool, beyond: bool| Explore { ready, beyond, by_pos, total: 0, moves: vec![], games: vec![] };
    if !dir.join("moves.bin").exists() { return Ok(empty(false, false)); }
    if moves.len() >= K { return Ok(empty(true, true)); }
    let sans: Vec<String> = fs::read_to_string(dir.join("san.txt")).unwrap_or_default().split('\n').map(|s| s.to_string()).collect();
    let mut q: Vec<u16> = Vec::new();
    for m in &moves {
        let t = norm_san(m.trim());
        match sans.iter().position(|s| s == t) {
            Some(p) => q.push((p + 1) as u16),
            None => return Ok(empty(true, false)),
        }
    }
    let n = q.len();
    // posição-alvo (só no modo por posição)
    let target: u32 = if by_pos && n > 0 {
        let mut p = Pos::start();
        for m in &moves { if !p.apply_san(norm_san(m.trim())) { return Ok(empty(true, false)); } }
        p.hash()
    } else { 0 };
    let names = names_of(&id)?;
    // filtro opcional: só partidas de um jogador (e, se pedido, só quando ele jogou de brancas ou de pretas)
    let pq = player.trim().to_lowercase();
    let pids: Option<HashSet<u32>> = if pq.is_empty() { None } else {
        Some(names.iter().enumerate().filter(|(_, s)| s.to_lowercase().contains(&pq)).map(|(i, _)| i as u32).collect())
    };
    let mut gf = BufReader::with_capacity(1 << 20, File::open(dir.join("games.bin")).map_err(|e| e.to_string())?);
    let mut mf = BufReader::with_capacity(1 << 20, File::open(dir.join("moves.bin")).map_err(|e| e.to_string())?);
    let mut stats: HashMap<u16, [u64; 6]> = HashMap::new(); // n, w, d, b, soma elo, qtd elo
    let mut total: u64 = 0;
    let mut top: Vec<(u32, u64, Rec)> = Vec::new();
    let mut gb = [0u8; REC];
    let mut mb = vec![0u8; K * 2];
    let mut pf = if by_pos && n > 0 { Some(BufReader::with_capacity(1 << 20, File::open(dir.join("pos.bin")).map_err(|e| e.to_string())?)) } else { None };
    let mut pb = vec![0u8; K * 4];
    let mut idx: u64 = 0;
    loop {
        if gf.read_exact(&mut gb).is_err() || mf.read_exact(&mut mb).is_err() { break; }
        if let Some(f) = pf.as_mut() { if f.read_exact(&mut pb).is_err() { break; } }
        let this = idx;
        idx += 1;
        // `at` = quantos lances a partida já tinha quando chegou à posição (o próximo lance é o índice `at`)
        let mut at = n;
        if pf.is_some() { // por posição (a posição inicial, n = 0, não precisa de pos.bin: toda partida passa por ela)
            match (0..K).find(|&i| u32::from_le_bytes([pb[4 * i], pb[4 * i + 1], pb[4 * i + 2], pb[4 * i + 3]]) == target) {
                Some(i) => at = i + 1,
                None => continue,
            }
        } else {
            let mut ok = true;
            for i in 0..n { if u16::from_le_bytes([mb[2 * i], mb[2 * i + 1]]) != q[i] { ok = false; break; } }
            if !ok { continue; }
        }
        let r = rec_of(&gb);
        if let Some(sel) = &pids {
            let hit = match side.as_str() { "w" => sel.contains(&r.w), "b" => sel.contains(&r.b), _ => sel.contains(&r.w) || sel.contains(&r.b) };
            if !hit { continue; }
        }
        total += 1;
        let next = if at < K { u16::from_le_bytes([mb[2 * at], mb[2 * at + 1]]) } else { 0 };
        let score = if r.welo > 0 && r.belo > 0 { r.welo as u32 + r.belo as u32 } else { 0 };
        if next != 0 {
            let e = stats.entry(next).or_insert([0; 6]);
            e[0] += 1;
            match r.result { 1 => e[1] += 1, 3 => e[2] += 1, 2 => e[3] += 1, _ => {} }
            if score > 0 { e[4] += (score / 2) as u64; e[5] += 1; }
        }
        top.push((score, this, r));
        if top.len() > 400 { top.sort_by(|a, b| b.0.cmp(&a.0)); top.truncate(10); }
    }
    top.sort_by(|a, b| b.0.cmp(&a.0));
    top.truncate(10);
    let mut mv: Vec<MoveStat> = stats.into_iter().map(|(id, e)| MoveStat {
        san: sans.get(id as usize - 1).cloned().unwrap_or_default(), n: e[0], w: e[1], d: e[2], b: e[3],
        elo: if e[5] > 0 { (e[4] / e[5]) as u32 } else { 0 },
    }).collect();
    mv.sort_by(|a, b| b.n.cmp(&a.n));
    mv.truncate(25);
    let games = top.into_iter().map(|(_, i, r)| Row {
        i, white: names.get(r.w as usize).cloned().unwrap_or_default(), black: names.get(r.b as usize).cloned().unwrap_or_default(),
        welo: r.welo, belo: r.belo, year: r.year,
        result: match r.result { 1 => "1-0", 2 => "0-1", 3 => "1/2-1/2", _ => "*" }.to_string(),
    }).collect();
    Ok(Explore { ready: true, beyond: false, by_pos, total, moves: mv, games })
}

// ---------- busca de posição/padrão em partidas inteiras ----------
// Reproduz cada partida (a partir do PGN original) e procura a posição em qualquer lance. Lento em bases enormes:
// por isso roda em segundo plano, mostra progresso, envia os resultados à medida que aparecem e pode ser cancelada.
static FIND_CANCEL: AtomicBool = AtomicBool::new(false);
static FINDING: AtomicBool = AtomicBool::new(false);

enum Step { Go, Hit(u32), Bad }
fn find_token(tok: &mut Vec<u8>, pos: &mut Pos, ply: &mut u32, target: &Pos, exact: bool) -> Step {
    if tok.is_empty() { return Step::Go; }
    let b = &tok[..];
    let mut i = 0;
    while i < b.len() && b[i].is_ascii_digit() { i += 1; }
    let rest: &[u8] = if i > 0 { if i < b.len() && b[i] == b'.' { while i < b.len() && b[i] == b'.' { i += 1; } &b[i..] } else { &[] } } else { b };
    let mut out = Step::Go;
    if !rest.is_empty() && rest[0] != b'$' && rest[0] != b'*' {
        if let Ok(t) = std::str::from_utf8(rest) {
            let t = norm_san(t);
            if !t.is_empty() && b"KQRBNOabcdefgh".contains(&t.as_bytes()[0]) {
                if !pos.apply_san(t) { out = Step::Bad; } else { *ply += 1; if pos.matches(target, exact) { out = Step::Hit(*ply); } }
            }
        }
    }
    tok.clear();
    out
}
// Devolve o ply (meio-lance) da primeira ocorrência; None se não achou ou a partida não começa da posição inicial.
fn scan_game(text: &[u8], target: &Pos, exact: bool) -> Option<u32> {
    let mut pos = Pos::start();
    let mut ply = 0u32;
    let (mut in_c, mut depth) = (false, 0u32);
    let mut tok: Vec<u8> = Vec::with_capacity(12);
    for line in text.split(|&c| c == b'\n') {
        if !in_c && depth == 0 && line.first() == Some(&b'[') {
            if line.starts_with(b"[FEN") || line.starts_with(b"[SetUp \"1") { return None; }
            continue;
        }
        macro_rules! flush { () => { match find_token(&mut tok, &mut pos, &mut ply, target, exact) { Step::Go => {}, Step::Hit(p) => return Some(p), Step::Bad => return None } } }
        for &c in line.iter().chain(std::iter::once(&b' ')) {
            if in_c { if c == b'}' { in_c = false; } continue; }
            match c {
                b'{' => { flush!(); in_c = true; }
                b';' => { flush!(); break; }
                b'(' => { flush!(); depth += 1; }
                b')' => { flush!(); depth = depth.saturating_sub(1); }
                b' ' | b'\t' | b'\r' => flush!(),
                _ => { if depth == 0 { tok.push(c); } }
            }
        }
    }
    None
}

#[derive(Serialize)]
pub struct FindHit { pub row: Row, pub ply: u32 }

// Varre a base. Devolve (partidas vistas, achadas, cancelado). `hit` recebe cada resultado.
pub fn find_run(app: &AppHandle, id: &str, source: &str, ids: Option<HashSet<u32>>, side: &str, target: &Pos, exact: bool, max: u64, hit: &mut dyn FnMut(FindHit)) -> Result<(u64, u64, bool), String> {
    let dir = db_dir(id)?;
    let names = names_of(id)?;
    let total = fs::metadata(dir.join("games.bin")).map_err(|e| e.to_string())?.len() / REC as u64;
    let mut gf = BufReader::with_capacity(1 << 20, File::open(dir.join("games.bin")).map_err(|e| e.to_string())?);
    let mut src = BufReader::with_capacity(4 << 20, File::open(source).map_err(|_| format!("O arquivo original não foi encontrado: {}", source))?);
    let (mut cur_off, mut idx, mut found, mut scanned) = (0u64, 0u64, 0u64, 0u64);
    let mut b = [0u8; REC];
    let mut buf: Vec<u8> = Vec::new();
    let mut last = Instant::now();
    while gf.read_exact(&mut b).is_ok() {
        let r = rec_of(&b);
        let this = idx;
        idx += 1;
        if FIND_CANCEL.load(Ordering::Relaxed) { return Ok((scanned, found, true)); }
        if let Some(s) = &ids {
            let ok = match side { "w" => s.contains(&r.w), "b" => s.contains(&r.b), _ => s.contains(&r.w) || s.contains(&r.b) };
            if !ok { continue; }
        }
        if last.elapsed() > Duration::from_millis(250) {
            last = Instant::now();
            let _ = app.emit("dbfind-progress", json!({ "done": idx, "total": total, "found": found }));
        }
        if r.off != cur_off { src.seek_relative(r.off as i64 - cur_off as i64).map_err(|e| e.to_string())?; }
        buf.resize(r.len as usize, 0);
        src.read_exact(&mut buf).map_err(|e| e.to_string())?;
        cur_off = r.off + r.len as u64;
        scanned += 1;
        if let Some(ply) = scan_game(&buf, target, exact) {
            found += 1;
            hit(FindHit { row: Row {
                i: this,
                white: names.get(r.w as usize).cloned().unwrap_or_default(),
                black: names.get(r.b as usize).cloned().unwrap_or_default(),
                welo: r.welo, belo: r.belo,
                result: match r.result { 1 => "1-0", 2 => "0-1", 3 => "1/2-1/2", _ => "*" }.to_string(),
                year: r.year,
            }, ply });
            if found >= max { break; }
        }
    }
    Ok((scanned, found, false))
}

#[tauri::command]
pub fn db_find_cancel() { FIND_CANCEL.store(true, Ordering::Relaxed); }

#[tauri::command]
pub fn db_find(app: AppHandle, id: String, fen: String, exact: bool, max: u64, player: String, side: String) -> Result<(), String> {
    let target = Pos::from_fen(&fen).ok_or("Posição inválida.")?;
    let dir = db_dir(&id)?;
    let meta: DbMeta = serde_json::from_str(&fs::read_to_string(dir.join("meta.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let names = names_of(&id)?;
    let q = player.trim().to_lowercase();
    let ids: Option<HashSet<u32>> = if q.is_empty() { None } else {
        Some(names.iter().enumerate().filter(|(_, s)| s.to_lowercase().contains(&q)).map(|(i, _)| i as u32).collect())
    };
    if FINDING.swap(true, Ordering::SeqCst) { return Err("Já há uma busca em andamento.".into()); }
    FIND_CANCEL.store(false, Ordering::Relaxed);
    std::thread::spawn(move || {
        let app2 = app.clone();
        let r = find_run(&app, &id, &meta.source, ids, &side, &target, exact, max.clamp(1, 1000), &mut |h| { let _ = app2.emit("dbfind-hit", &h); });
        FINDING.store(false, Ordering::SeqCst);
        match r {
            Ok((scanned, found, cancelled)) => { let _ = app.emit("dbfind-done", json!({ "ok": true, "scanned": scanned, "found": found, "cancelled": cancelled })); }
            Err(e) => { let _ = app.emit("dbfind-done", json!({ "ok": false, "error": e })); }
        }
    });
    Ok(())
}

// ---------- busca por torneio (Event / Site): lê só o começo de cada partida no PGN original ----------
#[derive(Serialize)]
pub struct EvHit { row: Row, event: String, site: String }

// valores de [Event "..."] e [Site "..."] no cabeçalho (primeiros bytes da partida)
fn event_site(head: &[u8]) -> (String, String) {
    let (mut ev, mut si) = (String::new(), String::new());
    for line in head.split(|&c| c == b'\n') {
        let t = line.strip_suffix(b"\r").unwrap_or(line);
        if t.first() != Some(&b'[') { if t.is_empty() && (!ev.is_empty() || !si.is_empty()) { break; } continue; }
        if let Some((k, v)) = tag_of(t) {
            if k == "Event" { ev = v; } else if k == "Site" { si = v; }
        }
    }
    (ev, si)
}

// Varre a base lendo só o cabeçalho de cada partida. Devolve (partidas vistas, achadas, cancelado).
pub fn ev_run(app: &AppHandle, id: &str, source: &str, ids: Option<HashSet<u32>>, side: &str, q: &str, max: u64, hit: &mut dyn FnMut(EvHit)) -> Result<(u64, u64, bool), String> {
    let dir = db_dir(id)?;
    let names = names_of(id)?;
    let total = fs::metadata(dir.join("games.bin")).map_err(|e| e.to_string())?.len() / REC as u64;
    let mut gf = BufReader::with_capacity(1 << 20, File::open(dir.join("games.bin")).map_err(|e| e.to_string())?);
    let mut src = BufReader::with_capacity(4 << 20, File::open(source).map_err(|_| format!("O arquivo original não foi encontrado: {}", source))?);
    let (mut cur_off, mut idx, mut found, mut scanned) = (0u64, 0u64, 0u64, 0u64);
    let (mut b, mut buf) = ([0u8; REC], Vec::<u8>::new());
    let mut last = Instant::now();
    while gf.read_exact(&mut b).is_ok() {
        let r = rec_of(&b);
        let this = idx;
        idx += 1;
        if FIND_CANCEL.load(Ordering::Relaxed) { return Ok((scanned, found, true)); }
        if let Some(s) = &ids {
            let ok = match side { "w" => s.contains(&r.w), "b" => s.contains(&r.b), _ => s.contains(&r.w) || s.contains(&r.b) };
            if !ok { continue; }
        }
        if last.elapsed() > Duration::from_millis(250) {
            last = Instant::now();
            let _ = app.emit("dbfind-progress", json!({ "done": idx, "total": total, "found": found }));
        }
        if r.off != cur_off { src.seek_relative(r.off as i64 - cur_off as i64).map_err(|e| e.to_string())?; }
        let n = (r.len as usize).min(1500); // só o cabeçalho
        buf.resize(n, 0);
        src.read_exact(&mut buf).map_err(|e| e.to_string())?;
        cur_off = r.off + n as u64;
        scanned += 1;
        let (ev, si) = event_site(&buf);
        if ev.to_lowercase().contains(q) || si.to_lowercase().contains(q) {
            found += 1;
            hit(EvHit { row: Row {
                i: this,
                white: names.get(r.w as usize).cloned().unwrap_or_default(),
                black: names.get(r.b as usize).cloned().unwrap_or_default(),
                welo: r.welo, belo: r.belo,
                result: match r.result { 1 => "1-0", 2 => "0-1", 3 => "1/2-1/2", _ => "*" }.to_string(),
                year: r.year,
            }, event: ev, site: si });
            if found >= max { break; }
        }
    }
    Ok((scanned, found, false))
}

#[tauri::command]
pub fn db_events(app: AppHandle, id: String, query: String, max: u64, player: String, side: String) -> Result<(), String> {
    let q = query.trim().to_lowercase();
    if q.chars().count() < 2 { return Err("Digite pelo menos 2 letras do nome do torneio.".into()); }
    let dir = db_dir(&id)?;
    let meta: DbMeta = serde_json::from_str(&fs::read_to_string(dir.join("meta.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let names = names_of(&id)?;
    let pq = player.trim().to_lowercase();
    let ids: Option<HashSet<u32>> = if pq.is_empty() { None } else {
        Some(names.iter().enumerate().filter(|(_, s)| s.to_lowercase().contains(&pq)).map(|(i, _)| i as u32).collect())
    };
    if FINDING.swap(true, Ordering::SeqCst) { return Err("Já há uma busca em andamento.".into()); }
    FIND_CANCEL.store(false, Ordering::Relaxed);
    std::thread::spawn(move || {
        let app2 = app.clone();
        let r = ev_run(&app, &id, &meta.source, ids, &side, &q, max.clamp(1, 1000), &mut |h| { let _ = app2.emit("dbev-hit", &h); });
        FINDING.store(false, Ordering::SeqCst);
        match r {
            Ok((scanned, found, cancelled)) => { let _ = app.emit("dbev-done", json!({ "ok": true, "scanned": scanned, "found": found, "cancelled": cancelled })); }
            Err(e) => { let _ = app.emit("dbev-done", json!({ "ok": false, "error": e })); }
        }
    });
    Ok(())
}

// ---------- relatório de jogador (só com o índice, sem reler o PGN) ----------
#[derive(Serialize)]
pub struct LineStat { san: Vec<String>, n: u64, w: u64, d: u64, l: u64 }
#[derive(Serialize)]
pub struct YearStat { year: u16, n: u64, elo: u32 }
#[derive(Serialize)]
pub struct NameCount { name: String, n: u64 }
#[derive(Serialize)]
pub struct Report {
    ready: bool, games: u64, names: Vec<NameCount>,
    white: [u64; 4], black: [u64; 4], // n, vitórias, empates, derrotas (do ponto de vista do jogador)
    years: Vec<YearStat>, peak: u32, last: u32, opp: u32,
    w_first: Vec<LineStat>, w_lines: Vec<LineStat>, b_first: Vec<LineStat>, b_lines: Vec<LineStat>,
    best: Vec<Row>,
}
fn top_lines(m: HashMap<Vec<u16>, [u64; 4]>, sans: &[String], limit: usize) -> Vec<LineStat> {
    let mut v: Vec<(Vec<u16>, [u64; 4])> = m.into_iter().collect();
    v.sort_by(|a, b| b.1[0].cmp(&a.1[0]).then(a.0.cmp(&b.0)));
    v.truncate(limit);
    v.into_iter().map(|(k, e)| LineStat {
        san: k.iter().filter(|&&i| i != 0).map(|&i| sans.get(i as usize - 1).cloned().unwrap_or_default()).collect(),
        n: e[0], w: e[1], d: e[2], l: e[3],
    }).collect()
}
#[tauri::command(async)]
pub fn db_report(id: String, player: String, exact: bool) -> Result<Report, String> {
    let dir = db_dir(&id)?;
    let ready = dir.join("moves.bin").exists();
    let names = names_of(&id)?;
    let pq = player.trim().to_lowercase();
    if pq.is_empty() { return Err("Digite o nome do jogador.".into()); }
    let sel: HashSet<u32> = names.iter().enumerate().filter(|(_, s)| { let l = s.to_lowercase(); if exact { l == pq } else { l.contains(&pq) } }).map(|(i, _)| i as u32).collect();
    let sans: Vec<String> = fs::read_to_string(dir.join("san.txt")).unwrap_or_default().split('\n').map(|s| s.to_string()).collect();
    let mut gf = BufReader::with_capacity(1 << 20, File::open(dir.join("games.bin")).map_err(|e| e.to_string())?);
    let mut mf = if ready { Some(BufReader::with_capacity(1 << 20, File::open(dir.join("moves.bin")).map_err(|e| e.to_string())?)) } else { None };
    let (mut white, mut black) = ([0u64; 4], [0u64; 4]);
    let mut cnt: HashMap<u32, u64> = HashMap::new();
    let mut years: HashMap<u16, (u64, u64, u64)> = HashMap::new(); // jogos, soma elo, qtd elo
    let (mut peak, mut last, mut last_year, mut opp_sum, mut opp_n) = (0u32, 0u32, 0u16, 0u64, 0u64);
    let (mut wf, mut wl, mut bf, mut bl): (HashMap<Vec<u16>, [u64; 4]>, HashMap<Vec<u16>, [u64; 4]>, HashMap<Vec<u16>, [u64; 4]>, HashMap<Vec<u16>, [u64; 4]>) = Default::default();
    let mut wins: Vec<(u32, u64, Rec)> = Vec::new();
    let mut gb = [0u8; REC];
    let mut mb = vec![0u8; K * 2];
    let mut idx: u64 = 0;
    while gf.read_exact(&mut gb).is_ok() {
        let this = idx; idx += 1;
        if let Some(f) = mf.as_mut() { if f.read_exact(&mut mb).is_err() { break; } }
        let r = rec_of(&gb);
        let (mw, mbk) = (sel.contains(&r.w), sel.contains(&r.b));
        if mw == mbk { continue; } // nenhum dos dois, ou ambos (ambíguo)
        let is_w = mw;
        let me = if is_w { r.w } else { r.b };
        *cnt.entry(me).or_insert(0) += 1;
        let res = match (r.result, is_w) { (1, true) | (2, false) => 1, (3, _) => 2, (1, false) | (2, true) => 3, _ => 0 };
        let tot = if is_w { &mut white } else { &mut black };
        tot[0] += 1;
        if res != 0 { tot[res] += 1; }
        let (elo, oelo) = if is_w { (r.welo as u32, r.belo as u32) } else { (r.belo as u32, r.welo as u32) };
        if r.year > 0 { let y = years.entry(r.year).or_insert((0, 0, 0)); y.0 += 1; if elo > 0 { y.1 += elo as u64; y.2 += 1; } }
        if elo > 0 { peak = peak.max(elo); if r.year >= last_year { last = elo; last_year = r.year; } }
        if oelo > 0 { opp_sum += oelo as u64; opp_n += 1; }
        if res == 1 && oelo > 0 { wins.push((oelo, this, r)); if wins.len() > 200 { wins.sort_by(|a, b| b.0.cmp(&a.0)); wins.truncate(5); } }
        if ready {
            let ids: Vec<u16> = (0..K.min(6)).map(|i| u16::from_le_bytes([mb[2 * i], mb[2 * i + 1]])).collect();
            let bump = |m: &mut HashMap<Vec<u16>, [u64; 4]>, k: Vec<u16>| { let e = m.entry(k).or_insert([0; 4]); e[0] += 1; if res != 0 { e[res] += 1; } };
            if is_w { bump(&mut wf, ids[..1].to_vec()); bump(&mut wl, ids.clone()); }
            else { bump(&mut bf, ids[..2].to_vec()); bump(&mut bl, ids.clone()); }
        }
    }
    let games = white[0] + black[0];
    let mut nm: Vec<(u32, u64)> = cnt.into_iter().collect();
    nm.sort_by(|a, b| b.1.cmp(&a.1));
    nm.truncate(8);
    let mut ys: Vec<YearStat> = years.into_iter().map(|(year, (n, s, c))| YearStat { year, n, elo: if c > 0 { (s / c) as u32 } else { 0 } }).collect();
    ys.sort_by_key(|y| y.year);
    wins.sort_by(|a, b| b.0.cmp(&a.0));
    wins.truncate(5);
    Ok(Report {
        ready, games,
        names: nm.into_iter().map(|(i, n)| NameCount { name: names.get(i as usize).cloned().unwrap_or_default(), n }).collect(),
        white, black, years: ys, peak, last, opp: if opp_n > 0 { (opp_sum / opp_n) as u32 } else { 0 },
        w_first: top_lines(wf, &sans, 6), w_lines: top_lines(wl, &sans, 10), b_first: top_lines(bf, &sans, 6), b_lines: top_lines(bl, &sans, 10),
        best: wins.into_iter().map(|(_, i, r)| Row {
            i, white: names.get(r.w as usize).cloned().unwrap_or_default(), black: names.get(r.b as usize).cloned().unwrap_or_default(),
            welo: r.welo, belo: r.belo, year: r.year,
            result: match r.result { 1 => "1-0", 2 => "0-1", 3 => "1/2-1/2", _ => "*" }.to_string(),
        }).collect(),
    })
}

// ---------- partidas online (Lichess / Chess.com) viram uma database ----------
fn curl_to_file(app: &AppHandle, id: &str, url: &str, accept: Option<&str>, out: &PathBuf, phase: &str) -> Result<(), String> {
    let mut cmd = crate::sys::cmd("curl");
    cmd.args(["-fsSL", "--retry", "2", "-A", "BertChessToolkit/1.0 (personal use)"]);
    if let Some(a) = accept { cmd.args(["-H", &format!("Accept: {}", a)]); }
    cmd.arg("-o").arg(out).arg(url);
    let mut child = cmd.spawn().map_err(|e| format!("Não consegui executar o curl ({e}). Instale com: sudo pacman -S curl"))?;
    loop {
        match child.try_wait() {
            Ok(Some(st)) => { return if st.success() { Ok(()) } else { Err("Não consegui baixar (usuário inexistente, sem internet ou limite de requisições).".into()) }; }
            Ok(None) => {
                if CANCEL.load(Ordering::Relaxed) { let _ = child.kill(); return Err("cancelado".into()); }
                let done = fs::metadata(out).map(|m| m.len()).unwrap_or(0);
                let _ = app.emit("db-progress", json!({ "id": id, "done": done, "total": 0, "games": 0, "phase": phase }));
                std::thread::sleep(Duration::from_millis(300));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn download_online(app: &AppHandle, id: &str, dir: &PathBuf, site: &str, user: &str, max: u64, out_name: &str) -> Result<PathBuf, String> {
    let pgn = dir.join(out_name);
    if site == "lichess" {
        let url = format!("https://lichess.org/api/games/user/{}?clocks=false&evals=false&opening=false{}", user, if max > 0 { format!("&max={}", max) } else { String::new() });
        curl_to_file(app, id, &url, Some("application/x-chess-pgn"), &pgn, "Baixando do Lichess…")?;
    } else {
        let list = dir.join("archives.json");
        curl_to_file(app, id, &format!("https://api.chess.com/pub/player/{}/games/archives", user.to_lowercase()), None, &list, "Buscando meses no Chess.com…")?;
        let v: serde_json::Value = serde_json::from_str(&fs::read_to_string(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&list);
        let arch: Vec<String> = v["archives"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
        if arch.is_empty() { return Err("Esse usuário não tem partidas no Chess.com.".into()); }
        let mut out = BufWriter::new(File::create(&pgn).map_err(|e| e.to_string())?);
        let tmp = dir.join("month.pgn");
        for (i, url) in arch.iter().enumerate() {
            if CANCEL.load(Ordering::Relaxed) { return Err("cancelado".into()); }
            let _ = app.emit("db-progress", json!({ "id": id, "done": i as u64, "total": arch.len() as u64, "games": 0, "phase": format!("Chess.com: mês {} de {}", i + 1, arch.len()) }));
            curl_to_file(app, id, &format!("{}/pgn", url), None, &tmp, &format!("Chess.com: mês {} de {}", i + 1, arch.len()))?;
            let mut f = File::open(&tmp).map_err(|e| e.to_string())?;
            std::io::copy(&mut f, &mut out).map_err(|e| e.to_string())?;
            out.write_all(b"\n\n").map_err(|e| e.to_string())?;
        }
        out.flush().map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&tmp);
    }
    Ok(pgn)
}

// site: "lichess" | "chesscom". Baixa as partidas do usuário e indexa como database (o PGN fica dentro da pasta da database).
#[tauri::command]
pub fn db_online(app: AppHandle, site: String, user: String, max: u64) -> Result<String, String> {
    let user = user.trim().to_string();
    if user.is_empty() || user.len() > 40 || !user.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') { return Err("Nome de usuário inválido.".into()); }
    if site != "lichess" && site != "chesscom" { return Err("Site desconhecido.".into()); }
    let id = format!("db{}", now_ms());
    let dir = dbs_dir().join(&id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    CANCEL.store(false, Ordering::Relaxed);
    let id2 = id.clone();
    std::thread::spawn(move || {
        let label = format!("{}: {}", if site == "lichess" { "Lichess" } else { "Chess.com" }, user);
        let res = download_online(&app, &id2, &dir, &site, &user, max, "source.pgn").and_then(|p| {
            let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            run_import(&app, &p, &dir, &id2, &label, size)
        });
        match res {
            Ok(n) => { let _ = app.emit("db-done", json!({ "id": id2, "ok": true, "games": n })); }
            Err(e) => { let _ = fs::remove_dir_all(&dir); let _ = app.emit("db-done", json!({ "id": id2, "ok": false, "error": e })); }
        }
    });
    Ok(id)
}

// ---------- manutenção: jogadores, partidas vazias e duplicadas ----------
#[derive(Serialize)]
pub struct PlayerCount { name: String, n: u64 }

// Jogadores cujo nome contém `query` (com número de partidas); sem texto, os que mais jogaram.
#[tauri::command(async)]
pub fn db_players(id: String, query: String, limit: usize) -> Result<Vec<PlayerCount>, String> {
    let dir = db_dir(&id)?;
    let names = names_of(&id)?;
    let q = query.trim().to_lowercase();
    let sel: Option<HashSet<u32>> = if q.is_empty() { None } else {
        Some(names.iter().enumerate().filter(|(_, s)| s.to_lowercase().contains(&q)).map(|(i, _)| i as u32).collect())
    };
    let mut cnt: HashMap<u32, u64> = HashMap::new();
    let mut f = BufReader::with_capacity(1 << 20, File::open(dir.join("games.bin")).map_err(|e| e.to_string())?);
    let mut b = [0u8; REC];
    while f.read_exact(&mut b).is_ok() {
        let r = rec_of(&b);
        for p in [r.w, r.b] { if sel.as_ref().map_or(true, |s| s.contains(&p)) { *cnt.entry(p).or_insert(0) += 1; } }
    }
    let mut v: Vec<(u32, u64)> = cnt.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    v.truncate(limit.clamp(1, 500));
    Ok(v.into_iter().map(|(i, n)| PlayerCount { name: names.get(i as usize).cloned().unwrap_or_default(), n }).collect())
}

// Junta variações de nome ("Carlsen, Magnus", "Magnus Carlsen"…) num só jogador. O PGN original não é alterado.
#[tauri::command(async)]
pub fn db_merge_players(id: String, from: Vec<String>, to: String) -> Result<u64, String> {
    let dir = db_dir(&id)?;
    let to = to.trim().to_string();
    if to.is_empty() || from.is_empty() { return Err("Escolha os jogadores e o nome final.".into()); }
    let names = names_of(&id)?;
    let fromset: HashSet<&str> = from.iter().map(|s| s.as_str()).collect();
    let mut map: HashMap<String, u32> = HashMap::new();
    let mut list: Vec<String> = Vec::new();
    let mut remap: Vec<u32> = Vec::with_capacity(names.len());
    for n in names.iter() {
        let target: &str = if fromset.contains(n.as_str()) || *n == to { &to } else { n.as_str() };
        remap.push(intern(&mut map, &mut list, target));
    }
    let tmp = dir.join("games.bin.tmp");
    let mut f = BufReader::with_capacity(1 << 20, File::open(dir.join("games.bin")).map_err(|e| e.to_string())?);
    let mut out = BufWriter::with_capacity(1 << 20, File::create(&tmp).map_err(|e| e.to_string())?);
    let mut b = [0u8; REC];
    let mut changed: u64 = 0;
    while f.read_exact(&mut b).is_ok() {
        let w = u32::from_le_bytes(b[12..16].try_into().unwrap());
        let k = u32::from_le_bytes(b[16..20].try_into().unwrap());
        let (nw, nk) = (remap.get(w as usize).copied().unwrap_or(w), remap.get(k as usize).copied().unwrap_or(k));
        if nw != w || nk != k { changed += 1; }
        b[12..16].copy_from_slice(&nw.to_le_bytes());
        b[16..20].copy_from_slice(&nk.to_le_bytes());
        out.write_all(&b).map_err(|e| e.to_string())?;
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    let mut nm = BufWriter::new(File::create(dir.join("names.txt.tmp")).map_err(|e| e.to_string())?);
    for s in &list { nm.write_all(s.replace('\n', " ").as_bytes()).map_err(|e| e.to_string())?; nm.write_all(b"\n").map_err(|e| e.to_string())?; }
    nm.flush().map_err(|e| e.to_string())?;
    drop(nm);
    fs::rename(dir.join("names.txt.tmp"), dir.join("names.txt")).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("games.bin")).map_err(|e| e.to_string())?;
    if let Ok(mut g) = NAMES.lock() { *g = None; }
    Ok(changed)
}

#[derive(Serialize)]
pub struct Cleaned { empty: u64, dups: u64, games: u64 }

// Remove partidas sem lances e/ou duplicadas (mesmos jogadores, data, resultado e mesmos primeiros 30 plies).
#[tauri::command(async)]
pub fn db_clean(id: String, empty: bool, dups: bool) -> Result<Cleaned, String> {
    use std::hash::{Hash, Hasher};
    let dir = db_dir(&id)?;
    let mut gf = BufReader::with_capacity(1 << 20, File::open(dir.join("games.bin")).map_err(|e| e.to_string())?);
    let mut mf = BufReader::with_capacity(1 << 20, File::open(dir.join("moves.bin")).map_err(|_| "Esta database não tem índice de lances: importe de novo.".to_string())?);
    let (gt, mt) = (dir.join("games.bin.tmp"), dir.join("moves.bin.tmp"));
    let mut go = BufWriter::with_capacity(1 << 20, File::create(&gt).map_err(|e| e.to_string())?);
    let mut mo = BufWriter::with_capacity(1 << 20, File::create(&mt).map_err(|e| e.to_string())?);
    let has_pos = dir.join("pos.bin").exists();
    let pt = dir.join("pos.bin.tmp");
    let mut pf = if has_pos { Some(BufReader::with_capacity(1 << 20, File::open(dir.join("pos.bin")).map_err(|e| e.to_string())?)) } else { None };
    let mut po = if has_pos { Some(BufWriter::with_capacity(1 << 20, File::create(&pt).map_err(|e| e.to_string())?)) } else { None };
    let mut pb = vec![0u8; K * 4];
    let mut seen: HashSet<u64> = HashSet::new();
    let (mut ne, mut nd, mut kept) = (0u64, 0u64, 0u64);
    let mut gb = [0u8; REC];
    let mut mb = vec![0u8; K * 2];
    while gf.read_exact(&mut gb).is_ok() && mf.read_exact(&mut mb).is_ok() {
        if let Some(f) = pf.as_mut() { if f.read_exact(&mut pb).is_err() { break; } }
        if empty && mb[0] == 0 && mb[1] == 0 { ne += 1; continue; }
        if dups {
            let r = rec_of(&gb);
            let mut h = std::collections::hash_map::DefaultHasher::new();
            (r.w, r.b, r.result, r.year).hash(&mut h);
            mb.hash(&mut h);
            if !seen.insert(h.finish()) { nd += 1; continue; }
        }
        go.write_all(&gb).map_err(|e| e.to_string())?;
        mo.write_all(&mb).map_err(|e| e.to_string())?;
        if let Some(w) = po.as_mut() { w.write_all(&pb).map_err(|e| e.to_string())?; }
        kept += 1;
    }
    go.flush().map_err(|e| e.to_string())?;
    mo.flush().map_err(|e| e.to_string())?;
    if let Some(w) = po.as_mut() { w.flush().map_err(|e| e.to_string())?; }
    drop(go); drop(mo); drop(po);
    fs::rename(&gt, dir.join("games.bin")).map_err(|e| e.to_string())?;
    fs::rename(&mt, dir.join("moves.bin")).map_err(|e| e.to_string())?;
    if has_pos { fs::rename(&pt, dir.join("pos.bin")).map_err(|e| e.to_string())?; }
    let mp = dir.join("meta.json");
    let mut meta: DbMeta = serde_json::from_str(&fs::read_to_string(&mp).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    meta.games = kept;
    fs::write(&mp, serde_json::to_string(&meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(Cleaned { empty: ne, dups: nd, games: kept })
}

// ---------- perfil: várias contas (Lichess + Chess.com...) viram uma só database ----------
#[derive(Deserialize, Clone)]
pub struct Account { site: String, user: String }

fn valid_user(u: &str) -> bool { !u.is_empty() && u.len() <= 40 && u.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') }

// Baixa as partidas de todas as contas, junta num PGN só, indexa e unifica os nomes dos jogadores no nome do perfil.
#[tauri::command]
pub fn db_profile(app: AppHandle, name: String, accounts: Vec<Account>, max: u64) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() { return Err("Dê um nome ao perfil.".into()); }
    if accounts.is_empty() { return Err("Adicione pelo menos uma conta.".into()); }
    for a in &accounts {
        if !valid_user(a.user.trim()) { return Err(format!("Nome de usuário inválido: {}", a.user)); }
        if a.site != "lichess" && a.site != "chesscom" { return Err("Site desconhecido.".into()); }
    }
    let id = format!("db{}", now_ms());
    let dir = dbs_dir().join(&id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    CANCEL.store(false, Ordering::Relaxed);
    let id2 = id.clone();
    std::thread::spawn(move || {
        let work = || -> Result<u64, String> {
            let all = dir.join("source.pgn");
            let mut out = BufWriter::new(File::create(&all).map_err(|e| e.to_string())?);
            let mut users: Vec<String> = Vec::new();
            for (i, a) in accounts.iter().enumerate() {
                let user = a.user.trim().to_string();
                let part = download_online(&app, &id2, &dir, &a.site, &user, max, &format!("part{}.pgn", i))
                    .map_err(|e| if e == "cancelado" { e } else { format!("{} ({}): {}", user, if a.site == "lichess" { "Lichess" } else { "Chess.com" }, e) })?;
                let mut f = File::open(&part).map_err(|e| e.to_string())?;
                std::io::copy(&mut f, &mut out).map_err(|e| e.to_string())?;
                out.write_all(b"\n\n").map_err(|e| e.to_string())?;
                let _ = fs::remove_file(&part);
                users.push(user.to_lowercase());
            }
            out.flush().map_err(|e| e.to_string())?;
            drop(out);
            let size = fs::metadata(&all).map(|m| m.len()).unwrap_or(0);
            let n = run_import(&app, &all, &dir, &id2, &format!("Perfil: {}", name), size)?;
            // um jogador só: todas as variações dos nomes das contas viram o nome do perfil
            let names = names_of(&id2)?;
            let from: Vec<String> = names.iter().filter(|s| users.contains(&s.to_lowercase())).cloned().collect();
            if !from.is_empty() { let _ = db_merge_players(id2.clone(), from, name.clone()); }
            Ok(n)
        };
        match work() {
            Ok(n) => { let _ = app.emit("db-done", json!({ "id": id2, "ok": true, "games": n })); }
            Err(e) => { let _ = fs::remove_dir_all(&dir); let _ = app.emit("db-done", json!({ "id": id2, "ok": false, "error": e })); }
        }
    });
    Ok(id)
}
