/**
 * Personalización de shawarmas (masa + ingredientes + salsas).
 * 1 salsa incluida por unidad; cada salsa extra = $800.
 */

export const SALSAS_SHAWARMA = ["Ajo", "Merkén", "Cilantro", "Ciboulette"];
export const PRECIO_SALSA_EXTRA = 800;

/** Elección de masa (mismo precio). */
export const MASAS_SHAWARMA = [
  { id: "tradicional", label: "Masa Tradicional" },
  {
    id: "multigrano",
    label: "Masa Multigrano",
    detalle: "con maravilla, chía, linaza y avena",
  },
];
export const MASA_DEFAULT = "tradicional";

/** Shawarmas cuyo relleno incluye elección Carne o Pollo. */
const PROTEINA_OPCIONES = ["Carne", "Pollo"];

export function labelMasaShawarma(masaId) {
  const m = MASAS_SHAWARMA.find((x) => x.id === masaId);
  return m?.label || MASAS_SHAWARMA[0].label;
}

export function esShawarma(producto) {
  return producto?.categoria === "shawarmas";
}

/**
 * Parsea la descripción de carta ("Lechuga - Tomate - Palta")
 * y separa la elección "Carne o Pollo" si aparece.
 */
export function parseIngredientesShawarma(producto) {
  const raw = String(producto?.descripcion || "")
    .split("-")
    .map((s) => s.trim())
    .filter(Boolean);

  const fijos = [];
  let eligeProteina = false;

  for (const part of raw) {
    const lower = part.toLowerCase();
    if (lower === "carne o pollo" || lower === "pollo o carne") {
      eligeProteina = true;
      continue;
    }
    fijos.push(part);
  }

  return { fijos, eligeProteina, proteinaOpciones: PROTEINA_OPCIONES };
}

export function extrasSalsaCount(salsasSeleccionadas) {
  const n = (salsasSeleccionadas || []).length;
  return Math.max(0, n - 1);
}

export function precioUnitarioShawarma(precioBase, salsasSeleccionadas) {
  const base = Number(precioBase) || 0;
  return base + extrasSalsaCount(salsasSeleccionadas) * PRECIO_SALSA_EXTRA;
}

export function labelShawarmaLinea({ ingredientes, proteina, salsas, extras, masa }) {
  const parts = [];
  if (proteina) parts.push(proteina);
  parts.push(...(ingredientes || []));
  const ings = parts.join(" - ");
  const masaTxt = labelMasaShawarma(masa || MASA_DEFAULT);
  const salsaTxt = (salsas || []).join(", ") || "sin salsa";
  const extraTxt =
    extras > 0 ? ` (+${extras} salsa${extras > 1 ? "s" : ""} extra)` : "";
  return `${masaTxt} · ${ings} · Salsa: ${salsaTxt}${extraTxt}`;
}
