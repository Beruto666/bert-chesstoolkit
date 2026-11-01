// Banco de puzzles do Lichess (lichess_db_puzzle.csv.zst, CC0): baixado uma vez e filtrado em streaming (curl + zstd).
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

static CANCEL: AtomicBool = AtomicBool::new(false);
const URL: &str = "https://database.lichess.org/lichess_db_puzzle.csv.zst";

fn db_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("lichess_db_puzzle.csv.zst")).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct LpStatus {
    file: Option<String>,
    mb: u64,
    zstd: bool,
}

#[cfg(not(windows))]
fn have_zstd() -> bool {
    Command::new("zstd").arg("-V").stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}
#[cfg(windows)]
fn have_zstd() -> bool { true }

#[tauri::command]
pub fn lp_status(app: AppHandle) -> Result<LpStatus, String> {
    let f = db_file(&app)?;
    let meta = std::fs::metadata(&f).ok().filter(|m| m.len() > 10_000_000);
    let zstd = have_zstd();
    Ok(LpStatus { file: meta.as_ref().map(|_| f.to_string_lossy().to_string()), mb: meta.map(|m| m.len() / 1_048_576).unwrap_or(0), zstd })
}

#[tauri::command]
pub fn lp_cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}

// Baixa o banco (≈250 MB). Emite "lp-progress" com texto.
#[tauri::command(async)]
pub fn lp_download(app: AppHandle) -> Result<String, String> {
    CANCEL.store(false, Ordering::Relaxed);
    let f = db_file(&app)?;
    if let Some(d) = f.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    let tmp = f.with_extension("zst.tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut child = crate::sys::curl()
        .args(["-fsL", "--retry", "2", "-A", "Bert-ChessToolkit", "-o"])
        .arg(&tmp)
        .arg(URL)
        .spawn()
        .map_err(|e| format!("Não consegui executar o curl: {}. Instale com: sudo pacman -S curl", e))?;
    let ok = loop {
        if CANCEL.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = std::fs::remove_file(&tmp);
            return Err("cancelado".to_string());
        }
        match child.try_wait() {
            Ok(Some(st)) => break st.success(),
            Ok(None) => {
                let mb = std::fs::metadata(&tmp).map(|m| m.len() / 1_048_576).unwrap_or(0);
                let _ = app.emit("lp-progress", format!("Baixando os puzzles do Lichess: {} MB de ≈250 MB…", mb));
                std::thread::sleep(Duration::from_millis(400));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    if !ok || std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0) < 10_000_000 {
        let _ = std::fs::remove_file(&tmp);
        return Err("Não consegui baixar o banco de puzzles. Verifique a internet.".to_string());
    }
    let _ = std::fs::remove_file(&f);
    std::fs::rename(&tmp, &f).map_err(|e| e.to_string())?;
    Ok(f.to_string_lossy().to_string())
}

#[derive(Serialize, Debug)]
pub struct LpRow {
    id: String,
    fen: String,
    moves: String,
    rating: u32,
    themes: String,
    opening: String,
}

pub struct Filter {
    pub themes: Vec<String>,
    pub all: bool,
    pub min: u32,
    pub max: u32,
    pub pop: i32,
    pub count: usize,
    pub random: bool,
    pub opening: String,
}

// Filtra as linhas do CSV (PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags).
// Com `random`, sorteia `count` linhas entre todas as que passam (amostragem uniforme); senão devolve as primeiras.
pub fn filter_lines<R: BufRead>(mut rd: R, f: &Filter, mut stop: impl FnMut() -> bool) -> Result<Vec<LpRow>, String> {
    let mut out: Vec<LpRow> = Vec::new();
    let mut seen: u64 = 0;
    let mut rng: u64 = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(88172645463325252) | 1;
    let mut buf = String::new();
    let mut n: u64 = 0;
    loop {
        buf.clear();
        if rd.read_line(&mut buf).map_err(|e| e.to_string())? == 0 {
            break;
        }
        n += 1;
        if n % 8192 == 0 && stop() {
            return Err("cancelado".to_string());
        }
        let line = buf.trim_end();
        let c: Vec<&str> = line.split(',').collect();
        if c.len() < 8 || c[0] == "PuzzleId" {
            continue;
        }
        let rating: u32 = match c[3].parse() { Ok(v) => v, Err(_) => continue };
        if rating < f.min || rating > f.max {
            continue;
        }
        if f.pop > -100 && c[5].parse::<i32>().unwrap_or(-100) < f.pop {
            continue;
        }
        if !f.themes.is_empty() {
            let have: Vec<&str> = c[7].split(' ').collect();
            let hit = if f.all { f.themes.iter().all(|t| have.contains(&t.as_str())) } else { f.themes.iter().any(|t| have.contains(&t.as_str())) };
            if !hit {
                continue;
            }
        }
        let opening = c.get(9).copied().unwrap_or("");
        if !f.opening.is_empty() && !opening.to_lowercase().contains(&f.opening.to_lowercase()) {
            continue;
        }
        let row = LpRow { id: c[0].to_string(), fen: c[1].to_string(), moves: c[2].to_string(), rating, themes: c[7].to_string(), opening: opening.to_string() };
        if !f.random {
            out.push(row);
            if out.len() >= f.count {
                break;
            }
        } else if out.len() < f.count {
            out.push(row);
            seen += 1;
        } else {
            rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
            let j = (rng % (seen + 1)) as usize;
            seen += 1;
            if j < f.count {
                out[j] = row;
            }
        }
    }
    Ok(out)
}

// O arquivo do Lichess começa com um "skippable frame" (metadado, magic 0x184D2A5?) que o ruzstd não pula sozinho: pula aqui.
#[cfg(any(windows, test))]
fn skip_skippable<F: std::io::Read + std::io::Seek>(fh: &mut F) -> std::io::Result<()> {
    use std::io::SeekFrom;
    loop {
        let pos = fh.stream_position()?;
        let mut h = [0u8; 8];
        if fh.read_exact(&mut h).is_err() {
            fh.seek(SeekFrom::Start(pos))?;
            return Ok(());
        }
        let magic = u32::from_le_bytes([h[0], h[1], h[2], h[3]]);
        if (0x184D_2A50..=0x184D_2A5F).contains(&magic) {
            fh.seek(SeekFrom::Current(u32::from_le_bytes([h[4], h[5], h[6], h[7]]) as i64))?;
        } else {
            fh.seek(SeekFrom::Start(pos))?;
            return Ok(());
        }
    }
}

#[tauri::command(async)]
pub fn lp_query(app: AppHandle, themes: Vec<String>, all: bool, min: u32, max: u32, pop: i32, count: usize, random: bool, opening: String) -> Result<Vec<LpRow>, String> {
    CANCEL.store(false, Ordering::Relaxed);
    let f = db_file(&app)?;
    if !Path::new(&f).exists() {
        return Err("Baixe primeiro o banco de puzzles.".to_string());
    }
    #[cfg(not(windows))]
    let mut child = Command::new("zstd")
        .arg("-dc")
        .arg(&f)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "O programa zstd não foi encontrado. Instale com: sudo pacman -S zstd (Arch), sudo apt install zstd (Debian/Ubuntu) ou sudo dnf install zstd (Fedora).".to_string())?;
    #[cfg(not(windows))]
    let out = child.stdout.take().ok_or("sem saída do zstd")?;
    // Windows: descompacta dentro do próprio app (não precisa instalar o zstd)
    #[cfg(windows)]
    let out = {
        let mut fh = std::fs::File::open(&f).map_err(|e| e.to_string())?;
        skip_skippable(&mut fh).map_err(|e| e.to_string())?;
        ruzstd::StreamingDecoder::new(BufReader::with_capacity(1 << 20, fh)).map_err(|e| format!("Arquivo de puzzles inválido: {e}"))?
    };
    let flt = Filter { themes, all, min, max, pop, count: count.clamp(1, 5000), random, opening };
    let res = filter_lines(BufReader::with_capacity(1 << 20, out), &flt, || CANCEL.load(Ordering::Relaxed));
    #[cfg(not(windows))]
    {
        let _ = child.kill();
        let _ = child.wait();
    }
    res
}
