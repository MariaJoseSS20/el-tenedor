/**
 * IndexedDB local para ventas offline (requisito crítico Punta Arenas).
 * Store: pending_sales — ventas aún no sincronizadas con el backend.
 */

const DB_NAME = "el-tenedor-pos";
const DB_VERSION = 1;
const STORE = "pending_sales";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "client_uuid" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePendingSale(sale) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(sale);
    tx.oncomplete = () => resolve(sale);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listPendingSales() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Ventas pendientes sincronizables del cajero actual.
 * Excluye las marcadas con sync_error y las de otro cajero (o sin cajero_id).
 */
export async function listSyncableSales(cajeroId) {
  const all = await listPendingSales();
  if (cajeroId == null) return [];
  return all.filter(
    (s) =>
      !s.sync_error &&
      s.cajero_id != null &&
      Number(s.cajero_id) === Number(cajeroId)
  );
}

export async function removePendingSales(uuids) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const id of uuids) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function markSalesRejected(rechazadas) {
  if (!rechazadas?.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    let pending = rechazadas.length;
    for (const item of rechazadas) {
      const uuid = item.client_uuid;
      const motivo = item.motivo || item.detail || "Rechazada por el servidor";
      const req = store.get(uuid);
      req.onsuccess = () => {
        const sale = req.result;
        if (sale) {
          sale.sync_error = motivo;
          store.put(sale);
        }
        pending -= 1;
        if (pending === 0) {
          /* wait for tx */
        }
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function countPendingSales(cajeroId) {
  const syncable = await listSyncableSales(cajeroId);
  return syncable.length;
}
