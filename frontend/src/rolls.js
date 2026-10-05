/**
 * Configurador «Arma tu Roll» (envoltura + relleno + acompañamiento + toppings + salsas).
 * Los precios de envoltura y toppings salen de productos en la API.
 */

export const PRECIO_SALSA_EXTRA_ROLL = 800;

export const ENVOLTURAS_ROLL = [
  "Panko",
  "Tempura",
  "Handroll",
  "Palta",
  "Ciboulette",
  "Sésamo",
  "Merkén",
  "Queso",
  "Salmón",
  "Jamón serrano",
  "Tenedor (doble envoltura)",
  "Luco",
  "Hosomaki",
  "Futomaki",
  "Futomaki frito",
];

export const RELLENOS_ROLL = [
  "Carne mechada",
  "Pollo teriyaki",
  "Kanikama",
  "Salmón",
  "Camarón",
  "Ciboulette",
];

export const ACOMP_QUESO = "Queso crema";

export const VEGETALES_ROLL = [
  "Palta",
  "Palmito",
  "Pimentón",
  "Pepino",
  "Champiñón",
  "Choclo",
  "Cebollín",
  "Ají verde",
];

export const TOPPINGS_ROLL = [
  { key: "ceviche", label: "Ceviche", producto: "Topping ceviche" },
  { key: "acevichada", label: "Acevichada", producto: "Topping acevichada" },
  { key: "teriyaki", label: "Teriyaki", producto: "Topping teriyaki" },
  { key: "sriracha", label: "Sriracha mayo", producto: "Topping sriracha mayo" },
];

export const SALSAS_ROLL = ["Unagui", "Soya", "Ajo", "Picante"];

const PREFIJO_ENV = "Arma tu Roll · ";

export function nombreProductoEnvoltura(env) {
  return `${PREFIJO_ENV}${env}`;
}

export function esProductoEnvolturaRoll(producto) {
  return (
    producto?.categoria === "rolls" &&
    String(producto?.nombre || "").startsWith(PREFIJO_ENV)
  );
}

export function esProductoToppingRoll(producto) {
  return TOPPINGS_ROLL.some((t) => t.producto === producto?.nombre);
}

/** Productos que no se listan solos en la carta (se arman en el modal). */
export function esProductoOcultoRoll(producto) {
  return esProductoEnvolturaRoll(producto) || esProductoToppingRoll(producto);
}

export function precioDesdeProductos(productos, nombre) {
  const p = (productos || []).find((x) => x.nombre === nombre);
  return p ? Number(p.precio) || 0 : null;
}

export function idProductoPorNombre(productos, nombre) {
  return (productos || []).find((x) => x.nombre === nombre)?.id || null;
}

function productoActivo(p) {
  // La carta pública no envía estado; solo lista activos.
  return Boolean(p) && (p.estado == null || p.estado === "activo");
}

export function envolturasDisponibles(productos) {
  return ENVOLTURAS_ROLL.map((env) => {
    const nombre = nombreProductoEnvoltura(env);
    const p = (productos || []).find((x) => x.nombre === nombre && productoActivo(x));
    if (!p) return null;
    return { env, producto: p, precio: Number(p.precio) || 0 };
  }).filter(Boolean);
}

export function toppingsDisponibles(productos) {
  return TOPPINGS_ROLL.map((t) => {
    const p = (productos || []).find((x) => x.nombre === t.producto && productoActivo(x));
    if (!p) return null;
    return { ...t, productoObj: p, precio: Number(p.precio) || 0 };
  }).filter(Boolean);
}

export function precioMinimoRoll(productos) {
  const env = envolturasDisponibles(productos);
  if (!env.length) return null;
  return Math.min(...env.map((e) => e.precio));
}

export function emptyToppingsState() {
  return Object.fromEntries(TOPPINGS_ROLL.map((t) => [t.key, false]));
}

export function emptySalsasRollState() {
  return Object.fromEntries(SALSAS_ROLL.map((s) => [s, false]));
}

export function toppingsSeleccionados(toppingsState, disponibles) {
  return (disponibles || []).filter((t) => toppingsState?.[t.key]);
}

export function salsasSeleccionadasRoll(salsasState) {
  return SALSAS_ROLL.filter((s) => salsasState?.[s]);
}

export function precioUnitarioRoll({
  precioEnvoltura,
  toppings,
  salsas,
  precioSalsaExtra = PRECIO_SALSA_EXTRA_ROLL,
}) {
  const base = Number(precioEnvoltura) || 0;
  const top = (toppings || []).reduce((a, t) => a + (Number(t.precio) || 0), 0);
  const salsasN = (salsas || []).length;
  return base + top + salsasN * (Number(precioSalsaExtra) || 0);
}

export function acompañamientoLabel(cfg) {
  if (cfg?.acompanamientoTipo === "queso") return ACOMP_QUESO;
  if (cfg?.acompanamientoTipo === "vegetal" && cfg.vegetal) return cfg.vegetal;
  return "";
}

export function labelRollArmado(cfg) {
  const parts = [];
  if (cfg.envoltura) parts.push(cfg.envoltura);
  if (cfg.relleno) {
    parts.push(
      cfg.relleno === "Pollo teriyaki" ? `${cfg.relleno} · con encurtido` : cfg.relleno
    );
  }
  const ac = acompañamientoLabel(cfg);
  if (ac) parts.push(ac);
  const tops = (cfg.toppingsLabels || []).filter(Boolean);
  if (tops.length) parts.push(`Topping: ${tops.join(", ")}`);
  const salsas = cfg.salsas || [];
  if (salsas.length) parts.push(`Salsas: ${salsas.join(", ")}`);
  return parts.join(" · ");
}

export function rollConfigCompleta(cfg) {
  if (!cfg?.envoltura || !cfg?.relleno) return false;
  if (cfg.acompanamientoTipo === "queso") return true;
  if (cfg.acompanamientoTipo === "vegetal" && cfg.vegetal) return true;
  return false;
}

/** Tarjeta sintética para la grilla (una sola, no 15 envolturas). */
export function tarjetaArmaTuRoll(productos) {
  const min = precioMinimoRoll(productos);
  if (min == null) return null;
  return {
    id: "arma-tu-roll",
    nombre: "Arma tu Roll",
    descripcion: "Elige envoltura, relleno y acompañamiento",
    precio: min,
    categoria: "rolls",
    estado: "activo",
    _virtualRoll: true,
  };
}
