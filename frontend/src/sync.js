import { api } from "./api.js";
import { listPendingSales, removePendingSales } from "./db.js";

let syncing = false;

/**
 * Empuja a /api/sync-ventas/ todas las ventas guardadas en IndexedDB.
 * Se dispara al volver online y manualmente desde la UI.
 */
export async function syncPendingSales() {
  if (syncing || !navigator.onLine) {
    return { skipped: true };
  }
  syncing = true;
  try {
    const pending = await listPendingSales();
    if (!pending.length) {
      return { creadas: [], omitidas_idempotentes: [], mensaje: "Nada pendiente." };
    }

    const payload = pending.map((s) => ({
      client_uuid: s.client_uuid,
      fecha_hora: s.fecha_hora,
      metodo_pago: s.metodo_pago,
      tipo_entrega: s.tipo_entrega,
      cobro_delivery: s.cobro_delivery,
      notas: s.notas || "",
      detalles: s.detalles.map((d) => ({
        producto: d.producto,
        cantidad: d.cantidad,
        notas: d.notas || "",
      })),
    }));

    const result = await api.syncVentas(payload);
    const done = [
      ...(result.creadas || []).map((x) => x.client_uuid),
      ...(result.omitidas_idempotentes || []),
    ];
    await removePendingSales(done);
    return result;
  } finally {
    syncing = false;
  }
}

export function watchConnectivity(onChange) {
  const fire = () => onChange(navigator.onLine);
  window.addEventListener("online", fire);
  window.addEventListener("offline", fire);
  fire();
  return () => {
    window.removeEventListener("online", fire);
    window.removeEventListener("offline", fire);
  };
}
