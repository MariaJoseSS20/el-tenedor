/**
 * Configurador «Arma tu Gohan».
 * Base $7.000 (producto Gohan). Furay opcional = producto «Proteína Furay».
 */

export const NOMBRE_GOHAN = "Gohan";
export const NOMBRE_FURAY = "Proteína Furay";

export const ESPOLVOREADOS_GOHAN = ["Merkén", "Ciboulette", "Sésamo"];

export const PROTEINAS_GOHAN = ["Pollo", "Carne", "Camarón", "Salmón", "Kanikama"];

export const VEGETALES_GOHAN = [
  "Cebollín",
  "Palmito",
  "Pimentón",
  "Palta",
  "Mango",
  "Ají verde",
  "Champiñón",
  "Choclo",
  "Zanahoria",
  "Encurtido de repollo",
  "Cebolla morada",
  "Cebolla caramelizada",
  "Berenjena crispy",
  "Pepino",
  "Encurtido de jengibre",
  "Maíz cancha",
];

export function esGohan(producto) {
  return producto?.categoria === "gohan" && producto?.nombre === NOMBRE_GOHAN;
}

export function esProductoOcultoGohan(producto) {
  return producto?.nombre === NOMBRE_FURAY;
}

export function productoGohan(productos) {
  return (productos || []).find((p) => esGohan(p) && (p.estado == null || p.estado === "activo"));
}

export function productoFuray(productos) {
  return (productos || []).find(
    (p) => p.nombre === NOMBRE_FURAY && (p.estado == null || p.estado === "activo")
  );
}

export function precioUnitarioGohan(precioBase, conFuray, precioFuray) {
  const base = Number(precioBase) || 0;
  return base + (conFuray ? Number(precioFuray) || 0 : 0);
}

export function gohanConfigCompleta(cfg) {
  if (!cfg?.espolvoreado || !cfg?.proteina) return false;
  const veggies = (cfg.vegetales || []).filter(Boolean);
  return veggies.length === 2;
}

export function labelGohanArmado(cfg) {
  const parts = [];
  if (cfg.proteina) {
    parts.push(cfg.furay ? `${cfg.proteina} furay` : cfg.proteina);
  }
  if (cfg.espolvoreado) parts.push(`Espolvoreado: ${cfg.espolvoreado}`);
  const veggies = (cfg.vegetales || []).filter(Boolean);
  if (veggies.length) parts.push(`Vegetales: ${veggies.join(", ")}`);
  return parts.join(" · ");
}

export function emptyGohanConfig() {
  return {
    espolvoreado: null,
    proteina: null,
    furay: false,
    vegetales: [],
    cantidad: 1,
  };
}
