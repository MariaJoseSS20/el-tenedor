/**
 * Composición por defecto de cada tabla (carta El Tenedor).
 * Cada roll tiene envoltura + ingredientes quitables.
 */
export const TABLAS_ROLLS = {
  "Tabla 27 Bocados": [
    { env: "ENV SÉSAMO", ingredientes: ["Pollo", "Queso", "Palmito"] },
    { env: "ENV QUESO", ingredientes: ["Kanikama", "Ciboulette"] },
    { env: "ENV PANKO", ingredientes: ["Camarón", "Queso", "Palta"] },
  ],
  "Tabla 36 Bocados": [
    { env: "ENV SÉSAMO", ingredientes: ["Pollo", "Queso", "Palmito"] },
    { env: "ENV QUESO", ingredientes: ["Kanikama", "Ciboulette"] },
    { env: "ENV PANKO", ingredientes: ["Camarón", "Queso", "Palta"] },
    { env: "ENV PALTA", ingredientes: ["Salmón", "Queso", "Cebollín"] },
  ],
  "Tabla 45 Bocados": [
    { env: "ENV PANKO", ingredientes: ["Pollo", "Queso", "Palmito"] },
    { env: "ENV QUESO", ingredientes: ["Kanikama", "Ciboulette"] },
    { env: "ENV SALMÓN", ingredientes: ["Camarón", "Queso", "Palta"] },
    { env: "ENV PALTA", ingredientes: ["Salmón", "Queso", "Cebollín"] },
    { env: "HOSOMAKI", ingredientes: ["Pollo"] },
  ],
  "Tabla 63 Bocados": [
    { env: "ENV PANKO", ingredientes: ["Pollo", "Queso", "Palmito"] },
    { env: "ENV PANKO", ingredientes: ["Camarón", "Queso", "Palta"] },
    { env: "ENV SALMÓN", ingredientes: ["Camarón", "Queso", "Cebollín"] },
    { env: "ENV QUESO", ingredientes: ["Kanikama", "Ciboulette"] },
    { env: "ENV PALTA", ingredientes: ["Salmón", "Queso", "Cebollín"] },
    { env: "ENV SÉSAMO", ingredientes: ["Carne", "Queso", "Palmito"] },
    { env: "HOSOMAKI", ingredientes: ["Salmón"] },
  ],
  "Tabla 90 Bocados": [
    { env: "ENV PANKO", ingredientes: ["Pollo", "Queso", "Palta"] },
    { env: "ENV PANKO", ingredientes: ["Camarón", "Queso", "Palta"] },
    { env: "ENV PANKO", ingredientes: ["Carne", "Queso", "Palta"] },
    { env: "ENV SALMÓN", ingredientes: ["Camarón", "Queso", "Cebollín"] },
    { env: "ENV QUESO", ingredientes: ["Kanikama", "Ciboulette"] },
    { env: "ENV PALTA", ingredientes: ["Salmón", "Queso", "Cebollín"] },
    { env: "ENV SÉSAMO", ingredientes: ["Pollo", "Queso", "Palmito"] },
    { env: "HOSOMAKI", ingredientes: ["Salmón"] },
    { env: "ENV JAMÓN SERRANO", ingredientes: ["Carne", "Queso", "Pimentón"] },
    { env: "FUTOMAKI", ingredientes: ["Palmito", "Queso", "Palta"] },
  ],
  "Tabla 108 Bocados": [
    { env: "ENV PANKO", ingredientes: ["Pollo", "Queso", "Palta"] },
    { env: "ENV PANKO", ingredientes: ["Camarón", "Queso", "Palta"] },
    { env: "ENV PANKO", ingredientes: ["Carne", "Queso", "Palta"] },
    { env: "ENV SALMÓN", ingredientes: ["Camarón", "Queso", "Cebollín"] },
    { env: "ENV QUESO", ingredientes: ["Kanikama", "Ciboulette"] },
    { env: "ENV PALTA", ingredientes: ["Salmón", "Queso", "Cebollín"] },
    { env: "ENV SÉSAMO", ingredientes: ["Pollo", "Queso", "Palmito"] },
    { env: "HOSOMAKI", ingredientes: ["Salmón"] },
    { env: "ENV JAMÓN SERRANO", ingredientes: ["Carne", "Queso", "Pimentón"] },
    { env: "FUTOMAKI", ingredientes: ["Palmito", "Queso", "Palta"] },
    { env: "HOSOMAKI", ingredientes: ["Salmón"] },
    { env: "ENV MERKÉN", ingredientes: ["Pollo", "Queso", "Cebollín"] },
  ],
};

export function rollsDeTabla(nombreProducto) {
  return TABLAS_ROLLS[nombreProducto] || null;
}

export function esTabla(producto) {
  return producto?.categoria === "tablas" && Boolean(rollsDeTabla(producto.nombre));
}

/** Texto legible de un roll según ingredientes aún incluidos. */
export function labelRoll(roll) {
  const ings = (roll.ingredientes || []).filter((i) => i.incluido).map((i) => i.nombre);
  if (!ings.length) return `${roll.env} · (sin ingredientes)`;
  return `${roll.env} · ${ings.join(" - ")}`;
}
