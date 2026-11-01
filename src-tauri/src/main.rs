#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::{Path, PathBuf}};
use sys::cmd;

#[derive(Serialize, Deserialize, Clone)]
struct Item {
    id: String,
    kind: String,
    title: String,
    author: String,
    #[serde(default)]
    category: String,
    // status de leitura: "" (não lido), "reading" (lendo) ou "done" (concluído) + uma nota curta
    #[serde(default)]
    status: String,
    #[serde(default)]
    note: String,
    cover: Option<String>,
    file: String,
    added: u64,
}

fn lib_dir() -> PathBuf {
    let p = sys::home().join("Biblioteca Bertonática");
    let _ = fs::create_dir_all(&p);
    p
}
fn db_path() -> PathBuf { lib_dir().join(".biblioteca.json") }
fn load() -> Vec<Item> {
    fs::read_to_string(db_path()).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
fn save(v: &Vec<Item>) -> Result<(), String> {
    let s = serde_json::to_string(v).map_err(|e| e.to_string())?;
    fs::write(db_path(), s).map_err(|e| e.to_string())
}
fn kind_of(p: &Path) -> Option<String> {
    let e = p.extension()?.to_str()?.to_lowercase();
    match e.as_str() { "pdf" | "epub" | "pgn" => Some(e), _ => None }
}
fn stem(p: &Path) -> String {
    p.file_stem().and_then(|s| s.to_str()).unwrap_or("").replace('_', " ")
}
fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs()).unwrap_or(0)
}

// Lista os itens e também "adota" arquivos que você colocar direto na pasta.
#[tauri::command]
fn list_items() -> Vec<Item> {
    let dir = lib_dir();
    let mut v = load();
    v.retain(|i| dir.join(&i.file).exists());
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_file() { continue; }
            if let (Some(k), Some(name)) = (kind_of(&p), p.file_name().and_then(|n| n.to_str())) {
                if !v.iter().any(|i| i.file == name) {
                    v.push(Item {
                        id: name.to_string(), kind: k, title: stem(&p),
                        author: String::new(), category: String::new(), status: String::new(), note: String::new(), cover: None,
                        file: name.to_string(), added: now(),
                    });
                }
            }
        }
    }
    let _ = save(&v);
    v
}

fn copy_unique(src: &Path, dir: &Path) -> Result<String, String> {
    let name = src.file_name().and_then(|n| n.to_str()).ok_or("nome inválido")?;
    let mut dest = dir.join(name);
    let mut n = 1;
    while dest.exists() && dest != src {
        let st = src.file_stem().unwrap().to_string_lossy().to_string();
        let ex = src.extension().unwrap().to_string_lossy().to_string();
        dest = dir.join(format!("{} ({}).{}", st, n, ex));
        n += 1;
    }
    if dest != src { fs::copy(src, &dest).map_err(|e| e.to_string())?; }
    Ok(dest.file_name().unwrap().to_string_lossy().to_string())
}

#[tauri::command]
fn add_files(paths: Vec<String>) -> Result<Vec<Item>, String> {
    let dir = lib_dir();
    for p in paths {
        let src = PathBuf::from(&p);
        if kind_of(&src).is_some() { copy_unique(&src, &dir)?; }
    }
    Ok(list_items())
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { walk(&p, out); }
            else if kind_of(&p).is_some() { out.push(p); }
        }
    }
}

// Importa uma pasta inteira; a categoria vem da subpasta de 1º nível
// (arquivos soltos na raiz recebem o nome da própria pasta escolhida).
#[tauri::command]
fn import_folder(path: String) -> Result<Vec<Item>, String> {
    let root = PathBuf::from(&path);
    let root_name = root.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let dir = lib_dir();
    let mut files = Vec::new();
    walk(&root, &mut files);
    let mut cats: Vec<(String, String)> = Vec::new();
    for f in files {
        let rel = f.strip_prefix(&root).unwrap_or(&f).to_path_buf();
        let cat = if rel.components().count() > 1 {
            rel.components().next().unwrap().as_os_str().to_string_lossy().to_string()
        } else { root_name.clone() };
        if let Ok(name) = copy_unique(&f, &dir) { cats.push((name, cat)); }
    }
    let mut v = list_items();
    for (name, cat) in cats {
        if let Some(i) = v.iter_mut().find(|i| i.file == name) { i.category = cat; }
    }
    save(&v)?;
    Ok(v)
}

#[tauri::command]
fn set_category(ids: Vec<String>, category: String) -> Result<Vec<Item>, String> {
    list_items();
    let mut v = load();
    for i in v.iter_mut() {
        if ids.contains(&i.id) { i.category = category.clone(); }
    }
    save(&v)?;
    Ok(v)
}

#[tauri::command]
fn set_status(ids: Vec<String>, status: String) -> Result<Vec<Item>, String> {
    list_items();
    let mut v = load();
    let st = if status == "reading" || status == "done" { status } else { String::new() };
    for i in v.iter_mut() {
        if ids.contains(&i.id) { i.status = st.clone(); }
    }
    save(&v)?;
    Ok(v)
}

// Capa automática: primeira imagem do PDF (JPEG em base64) ou o EPUB inteiro (o front-end lê o zip e acha a capa).
#[tauri::command(async)]
fn pdf_cover(id: String) -> Option<String> {
    let v = load();
    let i = v.iter().find(|i| i.id == id && i.kind == "pdf")?;
    cover::pdf_cover_b64(&lib_dir().join(&i.file))
}
#[tauri::command(async)]
fn epub_bytes(id: String) -> Option<String> {
    let v = load();
    let i = v.iter().find(|i| i.id == id && i.kind == "epub")?;
    let p = lib_dir().join(&i.file);
    if fs::metadata(&p).ok()?.len() > 60 << 20 { return None; }
    fs::read(&p).ok().map(|b| cover::b64(&b))
}

#[tauri::command]
fn update_item(id: String, title: String, author: String, category: String, status: String, note: String, cover: Option<String>) -> Result<Vec<Item>, String> {
    list_items();
    let mut v = load();
    if let Some(i) = v.iter_mut().find(|i| i.id == id) {
        i.title = title; i.author = author; i.category = category; i.cover = cover;
        i.status = if status == "reading" || status == "done" { status } else { String::new() };
        i.note = note;
    }
    save(&v)?;
    Ok(v)
}

#[tauri::command]
fn delete_item(id: String) -> Result<Vec<Item>, String> {
    let mut v = load();
    if let Some(i) = v.iter().find(|i| i.id == id) {
        let _ = fs::remove_file(lib_dir().join(&i.file));
    }
    v.retain(|i| i.id != id);
    save(&v)?;
    Ok(v)
}

// apaga vários itens de uma vez (e os arquivos deles)
#[tauri::command]
fn delete_items(ids: Vec<String>) -> Result<Vec<Item>, String> {
    let mut v = load();
    for i in v.iter().filter(|i| ids.contains(&i.id)) {
        let _ = fs::remove_file(lib_dir().join(&i.file));
    }
    v.retain(|i| !ids.contains(&i.id));
    save(&v)?;
    Ok(v)
}

fn cfg_path() -> PathBuf { lib_dir().join(".config.json") }
fn load_cfg() -> HashMap<String, String> {
    fs::read_to_string(cfg_path()).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn get_config() -> HashMap<String, String> { load_cfg() }

#[tauri::command]
fn set_opener(kind: String, path: Option<String>) -> Result<HashMap<String, String>, String> {
    let mut c = load_cfg();
    match path {
        Some(p) if !p.is_empty() => { c.insert(kind, p); }
        _ => { c.remove(&kind); }
    }
    let s = serde_json::to_string(&c).map_err(|e| e.to_string())?;
    fs::write(cfg_path(), s).map_err(|e| e.to_string())?;
    Ok(c)
}

#[tauri::command]
fn open_item(id: String) -> Result<(), String> {
    let v = load();
    let i = v.iter().find(|i| i.id == id).ok_or("item não encontrado")?;
    let file = lib_dir().join(&i.file);
    if let Some(app) = load_cfg().get(&i.kind).filter(|s| !s.is_empty()) {
        // limpa variáveis do nosso AppImage para não atrapalhar o outro programa
        return cmd(app).arg(&file)
            .env_remove("APPDIR").env_remove("APPIMAGE").env_remove("ARGV0").env_remove("OWD")
            .env_remove("LD_LIBRARY_PATH").env_remove("GDK_PIXBUF_MODULE_FILE")
            .env_remove("GTK_PATH").env_remove("GIO_EXTRA_MODULES")
            .spawn().map(|_| ())
            .map_err(|e| format!("Não consegui abrir com {}: {}", app, e));
    }
    sys::open_path(&file)
}

// O app baixa coisas (Stockfish, partidas online, aberturas) pelo curl: avisa logo se ele não existir.
#[tauri::command]
fn have_curl() -> bool {
    cmd("curl").arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
}

// Lê um arquivo de texto escolhido no diálogo de abrir.
#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    let b = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&b).into_owned())
}

// Pasta onde os diálogos de abrir começam: Downloads (xdg) ou a home.
#[tauri::command]
fn start_dir() -> String {
    let home = sys::home();
    if let Ok(o) = cmd("xdg-user-dir").arg("DOWNLOAD").output() {
        let p = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if !p.is_empty() && Path::new(&p).is_dir() { return p; }
    }
    let d = home.join("Downloads");
    (if d.is_dir() { d } else { home }).to_string_lossy().to_string()
}

#[tauri::command]
fn open_folder() -> Result<(), String> {
    sys::open_path(&lib_dir())
}

fn pgn_path(id: &str) -> Result<PathBuf, String> {
    let v = load();
    let i = v.iter().find(|i| i.id == id).ok_or("item não encontrado")?;
    Ok(lib_dir().join(&i.file))
}

// Lê o PGN inteiro (o preview antigo cortava em 20 mil caracteres).
#[tauri::command]
fn read_pgn(id: String) -> Result<String, String> {
    let b = fs::read(pgn_path(&id)?).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&b).into_owned())
}

// Regrava o PGN de um item da biblioteca (usado ao salvar a análise).
#[tauri::command]
fn write_pgn(id: String, text: String) -> Result<(), String> {
    fs::write(pgn_path(&id)?, text).map_err(|e| e.to_string())
}

// Cria um PGN novo na biblioteca a partir de texto e devolve o item.
#[tauri::command]
fn add_pgn_text(name: String, text: String, category: String) -> Result<Item, String> {
    let clean: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' || c == '(' || c == ')' { c } else { '_' })
        .collect();
    let stem = clean.trim().to_string();
    let stem = if stem.is_empty() { "partida".to_string() } else { stem };
    let dir = lib_dir();
    let mut file = format!("{}.pgn", stem);
    let mut n = 1;
    while dir.join(&file).exists() {
        file = format!("{} ({}).pgn", stem, n);
        n += 1;
    }
    fs::write(dir.join(&file), text).map_err(|e| e.to_string())?;
    let mut v = list_items(); // adota o arquivo novo
    let it = v.iter_mut().find(|i| i.file == file).ok_or("não consegui registrar o arquivo")?;
    it.title = name.trim().to_string();
    it.category = category.trim().to_string();
    let out = it.clone();
    save(&v)?;
    Ok(out)
}

// Grava texto num caminho escolhido pelo usuário (exportar PGN).
#[tauri::command]
fn export_text(path: String, text: String) -> Result<(), String> {
    fs::write(path, text).map_err(|e| e.to_string())
}

mod chessmini;
mod engine;
mod fsbrowse;
mod lipuz;
mod net;
mod pgndb;
mod sounds;
mod sys;
mod cover;

fn main() {
    tauri::Builder::default()
        .manage(engine::EngineState::default())
        .invoke_handler(tauri::generate_handler![
            list_items, add_files, update_item, delete_item, delete_items, pdf_cover, epub_bytes, open_item, open_folder, get_config, set_opener, import_folder, set_category, set_status, net::http_get, net::openings_load, read_pgn, write_pgn, add_pgn_text, export_text, read_file_text, start_dir, fsbrowse::fs_list, have_curl, lipuz::lp_status, lipuz::lp_cancel, lipuz::lp_download, lipuz::lp_query,
            pgndb::db_import, pgndb::db_cancel, pgndb::db_list, pgndb::db_delete, pgndb::db_page, pgndb::db_game, sounds::sound_play, sounds::sound_folder, pgndb::db_explore, pgndb::db_find, pgndb::db_report, pgndb::db_find_cancel, pgndb::db_events, pgndb::db_players, pgndb::db_merge_players, pgndb::db_clean, pgndb::db_online, pgndb::db_profile,
            engine::engine_start, engine::engine_send, engine::engine_stop, engine::engine_status, engine::engine_install
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o app");
}
