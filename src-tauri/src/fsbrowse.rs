// Navegador de pastas para o seletor de arquivos do próprio app (o diálogo nativo abre como outra janela, sem foco, em alguns
// ambientes Wayland/tiling). Só lista pastas e arquivos; ler/gravar usa os comandos que já existem.
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use crate::sys::{cmd, home as sys_home};

fn xdg(name: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let sub = match name { "DOWNLOAD" => "Downloads", "DOCUMENTS" => "Documents", _ => "Desktop" };
        let p = sys_home().join(sub);
        return p.is_dir().then_some(p);
    }
    #[cfg(not(windows))]
    {
        let o = cmd("xdg-user-dir").arg(name).output().ok()?;
        let p = PathBuf::from(String::from_utf8_lossy(&o.stdout).trim());
        (p.is_dir() && p != sys_home()).then_some(p)
    }
}
fn places() -> Vec<Value> {
    let home = sys_home();
    let mut v: Vec<(String, PathBuf)> = vec![("Início".into(), home.clone())];
    for (label, key) in [("Downloads", "DOWNLOAD"), ("Documentos", "DOCUMENTS"), ("Área de trabalho", "DESKTOP")] {
        if let Some(p) = xdg(key) {
            let name = if key == "DOWNLOAD" { p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(label.into()) } else { label.into() };
            v.push((name, p));
        }
    }
    let lib = crate::lib_dir();
    if lib.is_dir() { v.push(("Biblioteca".into(), lib)); }
    // pendrives e discos montados
    #[cfg(not(windows))]
    {
        if let Ok(user) = std::env::var("USER") {
            if let Ok(rd) = fs::read_dir(Path::new("/run/media").join(user)) {
                for e in rd.flatten() { if e.path().is_dir() { v.push((e.file_name().to_string_lossy().to_string(), e.path())); } }
            }
        }
        v.push(("Computador".into(), PathBuf::from("/")));
    }
    #[cfg(windows)]
    v.push(("Computador".into(), PathBuf::from(DRIVES)));
    v.into_iter().map(|(n, p)| json!({ "name": n, "path": p.to_string_lossy() })).collect()
}

// Windows: caminho especial que lista os discos (C:\, D:\…); o "pai" de uma raiz de disco.
#[cfg(windows)]
const DRIVES: &str = "::discos";
#[cfg(windows)]
fn drives() -> Value {
    let es: Vec<Value> = (b'A'..=b'Z')
        .filter_map(|c| { let p = format!("{}:\\", c as char); Path::new(&p).is_dir().then(|| json!({ "n": p, "d": true, "s": 0, "t": 0 })) })
        .collect();
    json!({ "path": DRIVES, "parent": Value::Null, "entries": es, "places": places() })
}
// tira o prefixo \\?\ que o canonicalize coloca no Windows
fn plain(p: &Path) -> String {
    let s = p.to_string_lossy().to_string();
    match s.strip_prefix(r"\\?\") { Some(r) if cfg!(windows) => r.to_string(), _ => s }
}

// Lista uma pasta (vazio = pasta inicial dos diálogos). Devolve { path, parent, entries:[{n, d, s, t}], places }.
#[tauri::command]
pub fn fs_list(path: String) -> Result<Value, String> {
    let want = if path.trim().is_empty() { PathBuf::from(crate::start_dir()) } else { PathBuf::from(path.trim()) };
    #[cfg(windows)]
    if path.trim() == DRIVES { return Ok(drives()); }
    let p = fs::canonicalize(&want).map_err(|_| format!("Pasta não encontrada: {}", want.display()))?;
    if !p.is_dir() { return Err("Isso não é uma pasta.".into()); }
    let rd = fs::read_dir(&p).map_err(|e| match e.kind() { std::io::ErrorKind::PermissionDenied => "Sem permissão para abrir esta pasta.".to_string(), _ => e.to_string() })?;
    let mut es: Vec<(bool, String, u64, u64)> = Vec::new();
    for e in rd.flatten().take(20000) {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        let Ok(md) = fs::metadata(e.path()) else { continue }; // segue links simbólicos; ignora os quebrados
        let t = md.modified().ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        es.push((md.is_dir(), name, md.len(), t));
    }
    es.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    Ok(json!({
        "path": plain(&p),
        "parent": p.parent().map(|q| plain(q)).or_else(|| if cfg!(windows) { Some("::discos".to_string()) } else { None }),
        "entries": es.into_iter().map(|(d, n, s, t)| json!({ "n": n, "d": d, "s": s, "t": t })).collect::<Vec<_>>(),
        "places": places(),
    }))
}
