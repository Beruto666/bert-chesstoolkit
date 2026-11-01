// Engine de xadrez (UCI): inicia o processo, repassa as linhas ao front-end e baixa o Stockfish.
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use crate::sys::cmd as command;
use std::process::{Child, ChildStdin, Command, Stdio};

#[cfg(windows)]
const SF: &str = "stockfish.exe";
#[cfg(not(windows))]
const SF: &str = "stockfish";
#[cfg(windows)]
const NULL: &str = "NUL";
#[cfg(not(windows))]
const NULL: &str = "/dev/null";
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct Eng {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct EngineState(pub Mutex<Option<Eng>>);

// Cada início de engine ganha um número; linhas de engines antigas são descartadas.
static ENGINE_GEN: AtomicU64 = AtomicU64::new(0);

fn kill_engine(slot: &mut Option<Eng>) {
    if let Some(mut e) = slot.take() {
        let _ = e.stdin.write_all(b"quit\n");
        let _ = e.child.kill();
        let _ = e.child.wait();
    }
}

fn clean_env(c: &mut Command) -> &mut Command {
    c.env_remove("APPDIR").env_remove("APPIMAGE").env_remove("ARGV0").env_remove("OWD")
        .env_remove("LD_LIBRARY_PATH").env_remove("GDK_PIXBUF_MODULE_FILE")
        .env_remove("GTK_PATH").env_remove("GIO_EXTRA_MODULES")
}

#[tauri::command]
pub fn engine_start(app: AppHandle, state: State<EngineState>, path: String) -> Result<(), String> {
    let mut slot = state.inner().0.lock().map_err(|e| e.to_string())?;
    kill_engine(&mut slot);
    let gen = ENGINE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let mut cmd = command(&path);
    clean_env(&mut cmd);
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Não consegui iniciar a engine ({}): {}", path, e))?;
    let stdin = child.stdin.take().ok_or("sem stdin")?;
    let stdout = child.stdout.take().ok_or("sem stdout")?;
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if ENGINE_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            match line {
                Ok(l) => {
                    let _ = handle.emit("engine-line", l);
                }
                Err(_) => break,
            }
        }
        if ENGINE_GEN.load(Ordering::SeqCst) == gen {
            let _ = handle.emit("engine-exit", ());
        }
    });
    *slot = Some(Eng { child, stdin });
    Ok(())
}

#[tauri::command]
pub fn engine_send(state: State<EngineState>, cmd: String) -> Result<(), String> {
    let mut slot = state.inner().0.lock().map_err(|e| e.to_string())?;
    let e = slot.as_mut().ok_or("Engine não iniciada")?;
    e.stdin.write_all(cmd.as_bytes()).map_err(|e| e.to_string())?;
    e.stdin.write_all(b"\n").map_err(|e| e.to_string())?;
    e.stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn engine_stop(state: State<EngineState>) -> Result<(), String> {
    let mut slot = state.inner().0.lock().map_err(|e| e.to_string())?;
    ENGINE_GEN.fetch_add(1, Ordering::SeqCst);
    kill_engine(&mut slot);
    Ok(())
}

#[derive(Serialize)]
pub struct EngineStatus {
    managed: Option<String>,
    system: Option<String>,
}

fn is_exec(p: &Path) -> bool {
    #[cfg(unix)]
    { std::fs::metadata(p).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false) }
    #[cfg(not(unix))]
    { p.is_file() }
}

fn engines_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("engines")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn engine_status(app: AppHandle) -> EngineStatus {
    let managed = engines_dir(&app)
        .ok()
        .map(|d| d.join(SF))
        .filter(|p| is_exec(p))
        .map(|p| p.to_string_lossy().to_string());
    let system = std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|d| d.join(SF))
            .find(|p| is_exec(p))
            .map(|p| p.to_string_lossy().to_string())
    });
    EngineStatus { managed, system }
}

fn find_stockfish(dir: &Path) -> Option<PathBuf> {
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if p.is_dir() {
            if let Some(f) = find_stockfish(&p) {
                return Some(f);
            }
        } else if let Some(n) = p.file_name().and_then(|n| n.to_str()) {
            let big = std::fs::metadata(&p).map(|m| m.len() > 1_000_000).unwrap_or(false);
            #[cfg(windows)]
            let nome_ok = n.to_lowercase().starts_with("stockfish") && n.to_lowercase().ends_with(".exe");
            #[cfg(not(windows))]
            let nome_ok = n.starts_with("stockfish") && !n.contains('.');
            if nome_ok && big {
                return Some(p);
            }
        }
    }
    None
}

// Baixa a versão mais recente do Stockfish (GitHub) para a pasta de dados do app.
#[tauri::command(async)]
pub fn engine_install(app: AppHandle) -> Result<String, String> {
    let say = |m: &str| {
        let _ = app.emit("engine-progress", m.to_string());
    };
    let dir = engines_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    say("Procurando a versão mais recente do Stockfish…");
    let out = command("curl")
        .args(["-sIL", "-o", NULL, "-w", "%{url_effective}", "https://github.com/official-stockfish/Stockfish/releases/latest"])
        .output()
        .map_err(|e| format!("Não encontrei o programa curl ({}). Instale com: sudo pacman -S curl", e))?;
    let url = String::from_utf8_lossy(&out.stdout).to_string();
    let tag = url
        .rsplit("/tag/")
        .next()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty() && !t.contains('/'))
        .unwrap_or_else(|| "sf_19".to_string());

    #[cfg(windows)]
    let candidates = vec![
        "stockfish-windows-x86-64-avx2.zip".to_string(),
        "stockfish-windows-x86-64-sse41-popcnt.zip".to_string(),
        "stockfish-windows-x86-64.zip".to_string(),
    ];
    #[cfg(not(windows))]
    let arch = if std::env::consts::ARCH == "aarch64" { "arm64" } else { "x86-64" };
    #[cfg(not(windows))]
    let candidates = vec![
        format!("stockfish-linux-{}-universal.tar.gz", arch),
        "stockfish-ubuntu-x86-64-avx2.tar".to_string(),
        "stockfish-ubuntu-x86-64-sse41-popcnt.tar".to_string(),
        "stockfish-ubuntu-x86-64.tar".to_string(),
    ];
    let archive = dir.join("download.tmp");
    let mut got = false;
    for name in candidates {
        let url = format!("https://github.com/official-stockfish/Stockfish/releases/download/{}/{}", tag, name);
        say(&format!("Baixando {} ({})…", name, tag));
        let _ = std::fs::remove_file(&archive);
        let mut child = command("curl")
            .args(["-fsL", "--retry", "2", "-o"])
            .arg(&archive)
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Não consegui executar o curl: {}", e))?;
        let ok = loop {
            match child.try_wait() {
                Ok(Some(st)) => break st.success(),
                Ok(None) => {
                    let mb = std::fs::metadata(&archive).map(|m| m.len() / 1_048_576).unwrap_or(0);
                    say(&format!("Baixando {} ({}): {} MB…", name, tag, mb));
                    std::thread::sleep(Duration::from_millis(400));
                }
                Err(e) => return Err(e.to_string()),
            }
        };
        if ok {
            got = true;
            break;
        }
    }
    if !got {
        let _ = std::fs::remove_file(&archive);
        return Err("Não consegui baixar o Stockfish. Verifique a internet ou instale pelo sistema (sudo pacman -S stockfish).".to_string());
    }

    say("Extraindo…");
    let tmp = dir.join("tmp");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let st = command("tar").arg("-xf").arg(&archive).arg("-C").arg(&tmp).status().map_err(|e| format!("Não consegui executar o tar: {}", e))?;
    if !st.success() {
        return Err("Falha ao extrair o arquivo baixado.".to_string());
    }
    let bin = find_stockfish(&tmp).ok_or("Não achei o programa dentro do arquivo baixado.")?;
    let dest = dir.join(SF);
    let _ = std::fs::remove_file(&dest);
    std::fs::copy(&bin, &dest).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&tmp);
    let _ = std::fs::remove_file(&archive);

    say("Testando…");
    let mut cmd = command(&dest);
    clean_env(&mut cmd);
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| format!("A engine baixada não inicia: {}", e))?;
    if let Some(mut si) = child.stdin.take() {
        let _ = si.write_all(b"uci\nquit\n");
    }
    let o = child.wait_with_output().map_err(|e| e.to_string())?;
    if !String::from_utf8_lossy(&o.stdout).contains("uciok") {
        return Err("A engine baixada não respondeu ao teste (uci).".to_string());
    }
    Ok(dest.to_string_lossy().to_string())
}

