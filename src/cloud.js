// Avaliação da nuvem do Lichess (cloud-eval): posições já analisadas por engines potentes, sem gastar a sua CPU.
const T = window.__TAURI__;
const key = (fen) => fen.split(" ").slice(0, 4).join(" ");
const memo = new Map(); // posição → resultado (ou null se a nuvem não tem)
let chain = Promise.resolve(), lastAt = 0;
const GAP = 1100; // o Lichess pede no máximo ~1 consulta por segundo

// Converte a resposta do Lichess (notas do ponto de vista das brancas) para o formato da engine (de quem joga).
function parseCloud(fen, body) {
  const j = typeof body === "string" ? JSON.parse(body) : body;
  const s = fen.split(" ")[1] === "b" ? -1 : 1;
  const lines = {};
  (j.pvs || []).forEach((p, i) => {
    lines[i + 1] = {
      depth: j.depth || 0, mpv: i + 1, nps: 0,
      pv: String(p.moves || "").split(" ").filter(Boolean),
      cp: p.cp != null ? p.cp * s : null,
      mate: p.mate != null ? p.mate * s : null,
    };
  });
  return { lines, depth: j.depth || 0, knodes: j.knodes || 0 };
}

// Devolve { lines, depth, knodes } ou null (a nuvem não tem a posição). Lança Error("rate" | "net" | "http N").
export function cloudEval(fen, multiPv = 2) {
  const k = key(fen) + "|" + multiPv;
  if (memo.has(k)) return Promise.resolve(memo.get(k));
  const job = chain.then(async () => {
    if (memo.has(k)) return memo.get(k);
    const wait = lastAt + GAP - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    const url = `https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multiPv}`;
    const r = await T.core.invoke("http_get", { url });
    if (r.status === 404) { memo.set(k, null); return null; }
    if (r.status === 429) throw new Error("rate");
    if (r.status === 0) throw new Error("net");
    if (r.status !== 200) throw new Error("http " + r.status);
    const res = parseCloud(fen, r.body);
    if (!res.lines[1]) { memo.set(k, null); return null; }
    memo.set(k, res);
    return res;
  });
  chain = job.catch(() => {});
  return job;
}
