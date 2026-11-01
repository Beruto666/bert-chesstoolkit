// Sons dos lances (padrão: os do Lichess, embutidos; "ok" e "bad" dos puzzles são sintetizados) tocados pelo sistema (pw-play / paplay / aplay), sem depender do WebAudio do WebKitGTK,
// que no Linux costuma ficar mudo. Os sons padrão são gerados aqui e gravados na pasta de sons; para trocar
// por outros (ex.: os do Lichess), basta substituir os arquivos (move, capture, castle, check, end, ok, bad)
// por .wav / .ogg / .flac com o mesmo nome.
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;

const KINDS: [&str; 7] = ["move", "capture", "castle", "check", "end", "ok", "bad"];
const SR: f32 = 44100.0;
const DEFAULTS: &str = "3"; // versão dos sons padrão

fn dir() -> PathBuf { crate::lib_dir().join(".sons") }

struct Rng(u32);
impl Rng { fn next(&mut self) -> f32 { self.0 ^= self.0 << 13; self.0 ^= self.0 >> 17; self.0 ^= self.0 << 5; (self.0 as f32 / u32::MAX as f32) * 2.0 - 1.0 } }

// Síntese "madeira macia": batida = soma de parciais que decaem rápido (modos de uma peça de madeira) + um toque
// de ruído filtrado só nos graves; sinos e marimba = senos com ataque suave. Nada de serra/triângulo (que cansa o ouvido).
fn modal(buf: &mut Vec<f32>, t0: f32, f: f32, parts: &[(f32, f32, f32)], vol: f32, attack: f32) {
    let longest = parts.iter().fold(0.0f32, |m, p| m.max(p.2));
    let n = (longest * 3.5 * SR) as usize;
    let start = (t0 * SR) as usize;
    if buf.len() < start + n { buf.resize(start + n, 0.0); }
    for &(ratio, amp, decay) in parts {
        let w = 2.0 * std::f32::consts::PI * f * ratio / SR;
        for i in 0..n {
            let t = i as f32 / SR;
            let env = (-t / decay).exp() * (t / attack).min(1.0);
            buf[start + i] += (w * i as f32).sin() * env * amp * vol;
        }
    }
}
// ruído passa-baixa com decaimento rápido (o "toc" surdo do contato)
fn thump(buf: &mut Vec<f32>, t0: f32, cutoff: f32, decay: f32, vol: f32, rng: &mut Rng) {
    let n = (decay * 6.0 * SR) as usize;
    let start = (t0 * SR) as usize;
    if buf.len() < start + n { buf.resize(start + n, 0.0); }
    let a = (-2.0 * std::f32::consts::PI * cutoff / SR).exp();
    let mut y = 0.0f32;
    for i in 0..n {
        y = a * y + (1.0 - a) * rng.next();
        y = a * y + (1.0 - a) * y; // segundo polo: corte mais suave
        let env = (-(i as f32 / SR) / decay).exp() * (i as f32 / (0.0008 * SR)).min(1.0);
        buf[start + i] += y * env * vol * 5.0;
    }
}
fn tap(b: &mut Vec<f32>, t: f32, f: f32, k: f32, r: &mut Rng) {
    modal(b, t, f, &[(1.0, 1.0, 0.040), (2.4, 0.45, 0.026), (4.1, 0.2, 0.016)], 0.8 * k, 0.0012);
    thump(b, t, 1600.0, 0.006, 0.55 * k, r);
}
fn bell(b: &mut Vec<f32>, t: f32, f: f32, vol: f32, decay: f32) {
    modal(b, t, f, &[(1.0, 1.0, decay), (2.0, 0.18, decay * 0.5), (3.0, 0.06, decay * 0.3)], vol, 0.008);
}
// sons do Lichess embutidos (já recortados, .wav mono); ok e bad são sintetizados
fn bundled(kind: &str) -> Option<&'static [u8]> {
    Some(match kind {
        "move" => include_bytes!("../sounds/move.wav"),
        "check" => include_bytes!("../sounds/check.wav"),
        "capture" => include_bytes!("../sounds/capture.wav"),
        "castle" => include_bytes!("../sounds/castle.wav"),
        "end" => include_bytes!("../sounds/end.wav"),
        _ => return None,
    })
}
fn render(kind: &str) -> Vec<f32> {
    let mut b: Vec<f32> = Vec::new();
    let mut r = Rng(0x1234_5678);
    let mut peak_to = 0.62f32;
    match kind {
        "capture" => {
            peak_to = 0.75;
            modal(&mut b, 0.0, 300.0, &[(1.0, 1.0, 0.060), (2.3, 0.55, 0.036), (3.9, 0.3, 0.022)], 0.9, 0.0012);
            thump(&mut b, 0.0, 1800.0, 0.012, 0.8, &mut r);
            tap(&mut b, 0.034, 430.0, 0.5, &mut r);
        }
        "castle" => { tap(&mut b, 0.0, 390.0, 1.0, &mut r); tap(&mut b, 0.12, 340.0, 0.9, &mut r); }
        "check" => { tap(&mut b, 0.0, 380.0, 1.0, &mut r); bell(&mut b, 0.07, 784.0, 0.32, 0.22); }
        "end" => { peak_to = 0.5; bell(&mut b, 0.0, 523.25, 0.5, 0.3); bell(&mut b, 0.2, 392.0, 0.5, 0.35); bell(&mut b, 0.42, 261.63, 0.55, 0.5); }
        "ok" => {
            peak_to = 0.5;
            modal(&mut b, 0.0, 659.0, &[(1.0, 1.0, 0.11), (4.0, 0.14, 0.04)], 0.5, 0.004);
            modal(&mut b, 0.085, 880.0, &[(1.0, 1.0, 0.16), (4.0, 0.14, 0.05)], 0.5, 0.004);
        }
        "bad" => {
            peak_to = 0.5;
            modal(&mut b, 0.0, 170.0, &[(1.0, 1.0, 0.11), (2.2, 0.3, 0.05)], 0.9, 0.003);
            thump(&mut b, 0.0, 900.0, 0.02, 0.4, &mut r);
        }
        _ => tap(&mut b, 0.0, 380.0, 1.0, &mut r),
    }
    let peak = b.iter().fold(0.0f32, |m, v| m.max(v.abs())).max(0.0001);
    for v in b.iter_mut() { *v = *v / peak * peak_to; }
    let fade = (0.01 * SR) as usize; // sem estalo no fim
    let len = b.len();
    for i in 0..fade.min(len) { b[len - 1 - i] *= i as f32 / fade as f32; }
    b
}
fn wav(samples: &[f32]) -> Vec<u8> {
    let n = samples.len() as u32 * 2;
    let mut o = Vec::with_capacity(44 + n as usize);
    o.extend_from_slice(b"RIFF"); o.extend_from_slice(&(36 + n).to_le_bytes()); o.extend_from_slice(b"WAVEfmt ");
    o.extend_from_slice(&16u32.to_le_bytes()); o.extend_from_slice(&1u16.to_le_bytes()); o.extend_from_slice(&1u16.to_le_bytes());
    o.extend_from_slice(&(SR as u32).to_le_bytes()); o.extend_from_slice(&(SR as u32 * 2).to_le_bytes());
    o.extend_from_slice(&2u16.to_le_bytes()); o.extend_from_slice(&16u16.to_le_bytes());
    o.extend_from_slice(b"data"); o.extend_from_slice(&n.to_le_bytes());
    for s in samples { o.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32000.0) as i16).to_le_bytes()); }
    o
}
fn ensure_files() -> PathBuf {
    let d = dir();
    let _ = fs::create_dir_all(&d);
    // versão dos sons padrão: quando muda, os .wav padrão são regravados (arquivos de outros formatos, como .ogg, não são tocados)
    let marker = d.join(".padrao");
    let fresh = fs::read_to_string(&marker).map(|v| v.trim() == DEFAULTS).unwrap_or(false);
    for k in KINDS {
        if !fresh || !d.join(format!("{k}.wav")).exists() {
            let bytes = bundled(k).map(|b| b.to_vec()).unwrap_or_else(|| wav(&render(k)));
            let _ = fs::write(d.join(format!("{k}.wav")), bytes);
        }
    }
    if !fresh { let _ = fs::write(&marker, DEFAULTS); }
    d
}
#[cfg(not(windows))]
fn player() -> Option<&'static str> {
    static P: OnceLock<Option<&'static str>> = OnceLock::new();
    *P.get_or_init(|| ["pw-play", "paplay", "aplay", "play"].into_iter().find(|p| Command::new(p).arg("--version").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok()))
}
// o arquivo do som: o que estiver na pasta (padrão .wav; o usuário pode pôr .ogg/.flac/.mp3)
fn file_of(kind: &str) -> Option<PathBuf> {
    let d = dir();
    ["wav", "ogg", "flac", "mp3"].iter().map(|e| d.join(format!("{kind}.{e}"))).find(|p| p.exists())
}

#[tauri::command]
pub fn sound_play(kind: String) -> bool {
    if !KINDS.contains(&kind.as_str()) { return false; }
    #[cfg(not(windows))]
    let Some(p) = player() else { return false };
    static INIT: OnceLock<()> = OnceLock::new();
    INIT.get_or_init(|| { ensure_files(); }); // uma vez por execução: cria ou atualiza os sons padrão
    let Some(f) = file_of(&kind) else { return false };
    #[cfg(windows)]
    { return win_play(&f); }
    #[cfg(not(windows))]
    {
        let mut c = Command::new(p);
        if p == "aplay" { c.arg("-q"); }
        if p == "play" { c.arg("-q"); }
        match c.arg(f).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
            Ok(mut ch) => { std::thread::spawn(move || { let _ = ch.wait(); }); true }
            Err(_) => false,
        }
    }
}
// Windows: toca .wav pelo winmm (PlaySoundW); outros formatos caem no som do navegador.
#[cfg(windows)]
fn win_play(f: &std::path::Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "winmm")]
    extern "system" {
        fn PlaySoundW(name: *const u16, module: *mut core::ffi::c_void, flags: u32) -> i32;
    }
    if f.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("wav")) != Some(true) { return false; }
    let w: Vec<u16> = f.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    // SND_ASYNC | SND_NODEFAULT | SND_FILENAME
    unsafe { PlaySoundW(w.as_ptr(), core::ptr::null_mut(), 0x0001 | 0x0002 | 0x0002_0000) != 0 }
}
// abre a pasta (criando os arquivos padrão) para o usuário trocar os sons
#[tauri::command]
pub fn sound_folder() -> Result<(), String> {
    let d = ensure_files();
    crate::sys::open_path(&d)
}
