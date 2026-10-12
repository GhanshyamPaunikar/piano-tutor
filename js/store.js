// Tiny IndexedDB key/value store. Holds the folder handle, uploaded files, scores and song metadata.

let dbp;
function open() {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('keys', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const get = (k) => run('readonly', (s) => s.get(k)).catch(() => undefined);
export const set = (k, v) => run('readwrite', (s) => s.put(v, k)).catch(() => {});
export const del = (k) => run('readwrite', (s) => s.delete(k)).catch(() => {});
export const keys = () => run('readonly', (s) => s.getAllKeys()).catch(() => []);
