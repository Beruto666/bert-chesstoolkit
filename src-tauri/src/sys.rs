// Pequenas diferenças entre sistemas (Linux x Windows). No Linux tudo aqui se comporta exatamente como antes.
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;

// Command::new; no Windows não abre a janelinha preta do console.
pub fn cmd<S: AsRef<OsStr>>(prog: S) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(prog);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

// Pasta pessoal: $HOME (Linux) ou %USERPROFILE% (Windows).
pub fn home() -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(h) = std::env::var_os("USERPROFILE") { return PathBuf::from(h); }
    }
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

// Abre um arquivo ou pasta com o programa padrão do sistema.
pub fn open_path(p: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let mut c = cmd("explorer");
    #[cfg(not(windows))]
    let mut c = cmd("xdg-open");
    c.arg(p).spawn().map(|_| ()).map_err(|e| e.to_string())
}
