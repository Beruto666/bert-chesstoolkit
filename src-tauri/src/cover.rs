// Capa automática dos livros: acha a primeira imagem JPEG grande dentro do PDF (sem renderizar nada) e devolve em base64.
use std::io::Read;

fn find(h: &[u8], n: &[u8], from: usize) -> Option<usize> {
    if from >= h.len() { return None; }
    h[from..].windows(n.len()).position(|w| w == n).map(|p| p + from)
}
fn rfind(h: &[u8], n: &[u8], to: usize) -> Option<usize> {
    h[..to.min(h.len())].windows(n.len()).rposition(|w| w == n)
}
fn num_after(d: &[u8], key: &[u8]) -> Option<u32> {
    let p = find(d, key, 0)? + key.len();
    let s: String = d[p..].iter().skip_while(|c| c.is_ascii_whitespace()).take_while(|c| c.is_ascii_digit()).map(|&c| c as char).collect();
    s.parse().ok()
}

// Primeiro JPEG (DCTDecode, RGB ou cinza) com pelo menos 200x200 px e 8 KB.
pub fn pdf_first_jpeg(h: &[u8]) -> Option<Vec<u8>> {
    let mut from = 0;
    for _ in 0..60 {
        let p = find(h, b"/DCTDecode", from)?;
        from = p + 10;
        let Some(o) = rfind(h, b" obj", p) else { continue };
        let Some(s) = find(h, b"stream", p) else { continue };
        if s < o || s - o > 4000 { continue; }
        let dict = &h[o..s];
        if find(dict, b"/Image", 0).is_none() || find(dict, b"/DeviceCMYK", 0).is_some() { continue; }
        let (w, hh) = (num_after(dict, b"/Width").unwrap_or(0), num_after(dict, b"/Height").unwrap_or(0));
        if w < 200 || hh < 200 { continue; }
        let mut a = s + 6;
        if h.get(a) == Some(&b'\r') { a += 1; }
        if h.get(a) == Some(&b'\n') { a += 1; }
        let Some(e) = find(h, b"endstream", a) else { continue };
        let mut e2 = e;
        while e2 > a && h[e2 - 1].is_ascii_whitespace() { e2 -= 1; }
        let d = &h[a..e2];
        if d.len() > 8000 && d.starts_with(&[0xFF, 0xD8]) && d.ends_with(&[0xFF, 0xD9]) { return Some(d.to_vec()); }
    }
    None
}

pub fn b64(d: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = String::with_capacity(d.len() / 3 * 4 + 4);
    for c in d.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        o.push(T[(n >> 18) as usize & 63] as char);
        o.push(T[(n >> 12) as usize & 63] as char);
        o.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        o.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    o
}

// Lê só o começo do PDF (até 24 MB): a capa fica nas primeiras páginas.
pub fn pdf_cover_b64(path: &std::path::Path) -> Option<String> {
    let mut buf = Vec::new();
    std::fs::File::open(path).ok()?.take(24 << 20).read_to_end(&mut buf).ok()?;
    pdf_first_jpeg(&buf).map(|j| b64(&j))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn b64_ok() {
        assert_eq!(b64(b""), "");
        assert_eq!(b64(b"f"), "Zg==");
        assert_eq!(b64(b"fo"), "Zm8=");
        assert_eq!(b64(b"foo"), "Zm9v");
        assert_eq!(b64(b"foobar"), "Zm9vYmFy");
    }
}
