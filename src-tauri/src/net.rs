// Pedidos HTTP simples (GET) feitos pelo curl: evita problemas de CORS do navegador embutido.
use serde_json::{json, Value};
use std::io::Write;
use std::process::Stdio;

// Só as APIs públicas do Lichess (incl. explorador de aberturas e exportação de partidas), do Chess.com e a tablebase são permitidas.
fn allowed(url: &str) -> bool {
    const OK: [&str; 5] = [
        "https://lichess.org/api/", "https://lichess.org/game/export/", "https://explorer.lichess.ovh/",
        "https://api.chess.com/pub/", "https://tablebase.lichess.ovh/standard?fen=",
    ];
    OK.iter().any(|p| url.starts_with(p)) && !url.contains(char::is_whitespace)
}
// o token pessoal só vai para o Lichess (nunca para o Chess.com nem para a tablebase)
fn token_host(url: &str) -> bool { url.starts_with("https://lichess.org/") || url.starts_with("https://explorer.lichess.ovh/") }

// Devolve { status, body }. status 0 = falha de rede. `token`: token pessoal do Lichess (opcional, sem permissões);
// `accept`: "json" (padrão) ou "pgn"; `timeout`: segundos (padrão 15).
#[tauri::command(async)]
pub fn http_get(url: String, token: Option<String>, accept: Option<String>, timeout: Option<u64>) -> Result<Value, String> {
    if !allowed(&url) {
        return Err("Endereço não permitido.".to_string());
    }
    let acc = if accept.as_deref() == Some("pgn") { "application/x-chess-pgn" } else { "application/json" };
    let secs = timeout.unwrap_or(15).clamp(5, 90).to_string();
    let tok = token.filter(|t| token_host(&url) && (8..=100).contains(&t.len()) && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
    let mut cmd = crate::sys::curl();
    cmd.args(["-sL", "-m", &secs, "-A", "Bert-ChessToolkit", "-H", &format!("Accept: {}", acc), "-w", "\n%{http_code}"]);
    // o token vai por stdin (-K -), para não aparecer na lista de processos
    if tok.is_some() { cmd.args(["-K", "-"]).stdin(Stdio::piped()); } else { cmd.stdin(Stdio::null()); }
    let mut child = cmd.arg(&url).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| format!("Não consegui executar o curl: {}", e))?;
    if let Some(t) = tok {
        if let Some(mut si) = child.stdin.take() { let _ = si.write_all(format!("header = \"Authorization: Bearer {}\"\n", t).as_bytes()); }
    }
    let out = child.wait_with_output().map_err(|e| format!("Falha no curl: {}", e))?;
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let (body, code) = match text.rfind('\n') {
        Some(i) => (text[..i].to_string(), text[i + 1..].trim().parse::<u16>().unwrap_or(0)),
        None => (text, 0),
    };
    Ok(json!({ "status": code, "body": body }))
}

// Base de nomes de aberturas (lichess-org/chess-openings, CC0): baixada uma vez e guardada na pasta de dados.
// Devolve o TSV (eco, name, pgn) ou None se ainda não existe e não foi possível baixar.
#[tauri::command(async)]
pub fn openings_load(app: tauri::AppHandle, download: bool) -> Result<Option<String>, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file = dir.join("openings.tsv");
    if let Ok(t) = std::fs::read_to_string(&file) {
        if t.lines().count() > 1000 {
            return Ok(Some(t));
        }
    }
    if !download {
        return Ok(None);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut all = String::new();
    for (i, f) in ["a", "b", "c", "d", "e"].iter().enumerate() {
        let out = crate::sys::curl()
            .args(["-sfL", "-m", "30", "-A", "Bert-ChessToolkit"])
            .arg(format!("https://raw.githubusercontent.com/lichess-org/chess-openings/master/{}.tsv", f))
            .output()
            .map_err(|e| format!("Não consegui executar o curl: {}", e))?;
        if !out.status.success() {
            return Ok(None);
        }
        let t = String::from_utf8_lossy(&out.stdout).to_string();
        // todos os arquivos têm cabeçalho: mantém só o do primeiro
        let body: Vec<&str> = t.lines().collect();
        if i == 0 {
            all.push_str(&body.join("\n"));
        } else {
            all.push('\n');
            all.push_str(&body.iter().skip(1).cloned().collect::<Vec<_>>().join("\n"));
        }
    }
    if all.lines().count() < 1000 {
        return Ok(None);
    }
    let tmp = dir.join("openings.tmp");
    std::fs::write(&tmp, &all).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    Ok(Some(all))
}
