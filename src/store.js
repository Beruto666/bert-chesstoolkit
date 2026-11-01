// Armazenamento local (IndexedDB) compartilhado: puzzles, preferências, repertórios...
let db = null;
const mem = { meta: new Map(), data: new Map(), prefs: new Map(), reps: new Map() }; // fallback se o IndexedDB falhar
function openDb() {
  return new Promise((res) => {
    try {
      const r = indexedDB.open("puzzles-bertonatica", 3);
      r.onupgradeneeded = () => {
        for (const n of ["meta", "data", "prefs", "reps"]) {
          if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, { keyPath: "id" });
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
const idb = (store, mode, fn) => new Promise((res) => {
  if (!db) return res(null);
  try {
    const q = fn(db.transaction(store, mode).objectStore(store));
    q.onsuccess = () => res(q.result ?? null);
    q.onerror = () => res(null);
  } catch { res(null); }
});
export const getAll = async (s) => db ? (await idb(s, "readonly", (o) => o.getAll())) || [] : [...mem[s].values()];
export const getOne = async (s, id) => db ? idb(s, "readonly", (o) => o.get(id)) : mem[s].get(id) ?? null;
export const putRec = async (s, v) => { if (db) await idb(s, "readwrite", (o) => o.put(v)); else mem[s].set(v.id, v); };
export const delRec = async (s, id) => { if (db) await idb(s, "readwrite", (o) => o.delete(id)); else mem[s].delete(id); };
export const storeReady = openDb().then((d) => { db = d; });
