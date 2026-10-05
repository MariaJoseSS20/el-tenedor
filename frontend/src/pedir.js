import "./style.css";
import { escapeHtml } from "./dom.js";
import {
  MASAS_SHAWARMA,
  MASA_DEFAULT,
  SALSAS_SHAWARMA,
  PRECIO_SALSA_EXTRA,
  esShawarma,
  extrasSalsaCount,
  labelShawarmaLinea,
  parseIngredientesShawarma,
  precioUnitarioShawarma,
} from "./shawarmas.js";
import { esTabla } from "./tablas.js";
import {
  ACOMP_QUESO,
  PRECIO_SALSA_EXTRA_ROLL,
  RELLENOS_ROLL,
  SALSAS_ROLL,
  VEGETALES_ROLL,
  emptySalsasRollState,
  emptyToppingsState,
  envolturasDisponibles,
  esProductoOcultoRoll,
  labelRollArmado,
  precioUnitarioRoll,
  rollConfigCompleta,
  salsasSeleccionadasRoll,
  tarjetaArmaTuRoll,
  toppingsDisponibles,
  toppingsSeleccionados,
} from "./rolls.js";
import {
  ESPOLVOREADOS_GOHAN,
  NOMBRE_FURAY,
  PROTEINAS_GOHAN,
  VEGETALES_GOHAN,
  emptyGohanConfig,
  esGohan,
  esProductoOcultoGohan,
  gohanConfigCompleta,
  labelGohanArmado,
  precioUnitarioGohan,
  productoFuray,
  productoGohan,
} from "./gohan.js";

const rawBase = import.meta.env.VITE_API_URL || "";
const API_BASE = String(rawBase).replace(/\/$/, "");
const PRECIO_PALTA_EXTRA = 1000;

/** Extras que no se listan solos: se agregan al personalizar. */
const OCULTOS_CARTA = new Set([
  "Salsa extra",
  "Palta extra",
  "Proteína Furay",
  "Topping ceviche",
  "Topping acevichada",
  "Topping teriyaki",
  "Topping sriracha mayo",
]);

const CATEGORIAS = [
  ["ceviches", "Ceviches"],
  ["picoteo", "Para picar"],
  ["papas", "Papas"],
  ["shawarmas", "Shawarmas"],
  ["tablas", "Tablas"],
  ["rolls", "Arma tu Roll"],
  ["gohan", "Arma tu Gohan"],
  ["bebestibles", "Bebestibles"],
];

const CAT_LABEL = Object.fromEntries(CATEGORIAS);

/** Acento suave por categoría (solo color de ambiente, no cambia la marca). */
const CAT_TONE = {
  ceviches: "tone-sea",
  picoteo: "tone-sun",
  papas: "tone-gold",
  shawarmas: "tone-spice",
  tablas: "tone-coral",
  rolls: "tone-coral",
  gohan: "tone-leaf",
  bebestibles: "tone-sky",
};

const app = document.getElementById("app");

const state = {
  productos: [],
  categoria: "todas",
  busqueda: "",
  cart: [],
  cartOpen: false,
  nombre: "",
  telefono: "",
  tipo_entrega: "retiro",
  zonas: [],
  zonaId: null,
  direccion: "",
  nota_pedido: "",
  fieldErrors: {},
  shawarmaConfig: null,
  rollConfig: null,
  gohanConfig: null,
  addModal: null,
  loading: true,
  paying: false,
  error: null,
  toast: null,
  resultado: null,
  firstPaint: true,
  /** { abierto, mensaje, horario } desde /api/horario-pedidos/ */
  horario: { abierto: true, mensaje: "", horario: "" },
};

function pedidosAbiertos() {
  return state.horario?.abierto !== false;
}

let toastTimer = null;

function money(n) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(Number(n) || 0));
}

/** Precio arriba del modal: solo unidad; el total va en el botón. */
function precioModalHeader(unit, extra = "") {
  return `${money(unit)}${extra}`;
}

function showToast(msg, isError = false) {
  state.toast = { msg, isError };
  const existing = document.getElementById("pedir-toast");
  existing?.remove();
  const el = document.createElement("div");
  el.id = "pedir-toast";
  el.className = `pedir-toast ${isError ? "is-error" : ""}`;
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.remove();
    state.toast = null;
  }, 2800);
}

function idSalsaExtra() {
  return state.productos.find((p) => p.nombre === "Salsa extra")?.id || null;
}

function idPaltaExtra() {
  return state.productos.find((p) => p.nombre === "Palta extra")?.id || null;
}

function cartSubtotal() {
  return state.cart.reduce((a, l) => a + Number(l.precio) * Number(l.cantidad), 0);
}

function zonasActivas() {
  return state.zonas || [];
}

function zonaSeleccionada() {
  return zonasActivas().find((z) => String(z.id) === String(state.zonaId)) || null;
}

function aplicarZona(id) {
  const zona = zonasActivas().find((z) => String(z.id) === String(id));
  state.zonaId = zona ? zona.id : null;
  return zona;
}

function cartDelivery() {
  if (state.tipo_entrega !== "delivery") return 0;
  return Number(zonaSeleccionada()?.precio) || 0;
}

function cartTotal() {
  return cartSubtotal() + cartDelivery();
}

function cartItemsCount() {
  return state.cart.reduce((a, l) => a + Number(l.cantidad), 0);
}

function productosVisibles() {
  const q = state.busqueda.trim().toLowerCase();
  const base = state.productos.filter((p) => {
    if (p.categoria === "agregados") return false;
    if (OCULTOS_CARTA.has(p.nombre)) return false;
    if (esProductoOcultoRoll(p)) return false;
    if (esProductoOcultoGohan(p)) return false;
    if (state.categoria !== "todas" && p.categoria !== state.categoria) return false;
    if (!q) return true;
    return (
      p.nombre.toLowerCase().includes(q) ||
      String(p.descripcion || "")
        .toLowerCase()
        .includes(q)
    );
  });
  const card = tarjetaArmaTuRoll(state.productos);
  if (!card) return base;
  const matchCat =
    state.categoria === "todas" || state.categoria === "rolls";
  const matchQ =
    !q ||
    card.nombre.toLowerCase().includes(q) ||
    String(card.descripcion || "")
      .toLowerCase()
      .includes(q);
  if (!matchCat || !matchQ) return base;
  if (state.categoria === "rolls") return [card, ...base];
  const idx = base.findIndex((p) => p.categoria === "gohan");
  if (idx === -1) return [...base, card];
  return [...base.slice(0, idx), card, ...base.slice(idx)];
}

function productosPorSeccion() {
  const vis = productosVisibles();
  if (state.categoria !== "todas" || state.busqueda.trim()) {
    return [{ id: state.categoria, label: CAT_LABEL[state.categoria] || "Resultados", items: vis }];
  }
  return CATEGORIAS.map(([id, label]) => ({
    id,
    label,
    items: vis.filter((p) => p.categoria === id),
  })).filter((s) => s.items.length);
}

function mensajeErrorPublico(res, data, text) {
  if (res.status === 429) {
    const espera = String(data?.detail || "").match(/(\d+)\s*segundos?/i)?.[1];
    return espera
      ? `Hay muchas solicitudes seguidas. Espera ${espera} segundos y pulsa Reintentar.`
      : "Hay muchas solicitudes seguidas. Espera un momento y pulsa Reintentar.";
  }
  if (typeof data?.detail === "string" && data.detail) return data.detail;
  return text || `No se pudo conectar (error ${res.status}).`;
}

async function publicGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(mensajeErrorPublico(res, data, text));
  }
  return data;
}

async function publicPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(mensajeErrorPublico(res, data, text));
  }
  return data;
}

function leerResultadoUrl() {
  const params = new URLSearchParams(window.location.search);
  const pago = params.get("pago");
  if (!pago) return null;
  return {
    pago,
    pedido: params.get("pedido") || "",
    venta: params.get("venta") || "",
  };
}

function buildDetallesPayload() {
  return state.cart.flatMap((l) => {
    let notas = "";
    if (l.shawarma) notas = l.shawarma;
    if (l.rollArmado) notas = l.rollArmado;
    if (l.gohanArmado) notas = l.gohanArmado;
    if (l.nota) notas = notas ? `${notas} || ${l.nota}` : l.nota;
    const rows = [{ producto: l.producto, cantidad: l.cantidad, notas }];
    const extras = Number(l.extrasSalsa) || 0;
    if (extras > 0) {
      const salsaId = idSalsaExtra();
      if (salsaId) {
        rows.push({
          producto: salsaId,
          cantidad: extras * l.cantidad,
          notas: `Extra(s) de ${l.nombre}: ${(l.salsas || []).join(", ")}`,
        });
      }
    }
    const extrasSalsaRoll = Number(l.extrasSalsaRoll) || 0;
    if (extrasSalsaRoll > 0) {
      const salsaId = idSalsaExtra();
      if (salsaId) {
        rows.push({
          producto: salsaId,
          cantidad: extrasSalsaRoll * l.cantidad,
          notas: `Salsas de ${l.nombre}: ${(l.salsas || []).join(", ")}`,
        });
      }
    }
    for (const t of l.toppingsDetalle || []) {
      rows.push({
        producto: t.id,
        cantidad: l.cantidad,
        notas: `Topping ${t.label} en Arma tu Roll`,
      });
    }
    const extrasFuray = Number(l.extrasFuray) || 0;
    if (extrasFuray > 0 && l.furayProductoId) {
      rows.push({
        producto: l.furayProductoId,
        cantidad: extrasFuray * l.cantidad,
        notas: `Furay en Arma tu Gohan`,
      });
    }
    const extrasPalta = Number(l.extrasPalta) || 0;
    if (extrasPalta > 0) {
      const paltaId = idPaltaExtra();
      if (paltaId) {
        rows.push({
          producto: paltaId,
          cantidad: extrasPalta * l.cantidad,
          notas: `Palta extra en ${l.nombre}`,
        });
      }
    }
    return rows;
  });
}

function syncFormFromDom() {
  const nombre = document.getElementById("nombre");
  const telefono = document.getElementById("telefono");
  const direccion = document.getElementById("direccion");
  const nota = document.getElementById("nota_pedido");
  if (nombre) state.nombre = nombre.value;
  if (telefono) state.telefono = telefono.value;
  if (direccion) state.direccion = direccion.value;
  if (nota) state.nota_pedido = nota.value;
}

function redirigirWebpay(url, token) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "token_ws";
  input.value = token;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

function validarCheckout() {
  const errors = {};
  if (state.nombre.trim().length < 2) errors.nombre = "Indica tu nombre";
  if (state.telefono.trim().replace(/\D/g, "").length < 8) {
    errors.telefono = "Teléfono inválido";
  }
  if (state.tipo_entrega === "delivery" && !state.direccion.trim()) {
    errors.direccion = "Indica la dirección";
  }
  if (state.tipo_entrega === "delivery" && !zonaSeleccionada()) {
    errors.zona = zonasActivas().length
      ? "Elige la zona de delivery"
      : "Delivery no está disponible ahora";
  }
  if (!state.cart.length) errors.cart = "Agrega al menos un producto";
  state.fieldErrors = errors;
  return Object.keys(errors).length === 0;
}

async function pagar() {
  if (state.paying) return;
  try {
    const horario = await publicGet("/api/horario-pedidos/");
    state.horario = {
      abierto: Boolean(horario?.abierto),
      mensaje: horario?.mensaje || "",
      horario: horario?.horario || "",
    };
  } catch {
    /* si falla el check, el servidor igual puede rechazar */
  }
  if (!pedidosAbiertos()) {
    state.cartOpen = true;
    render();
    showToast(state.horario.mensaje || "Ahora no recibimos pedidos online", true);
    return;
  }
  syncFormFromDom();
  if (!validarCheckout()) {
    state.cartOpen = true;
    render();
    const first = Object.keys(state.fieldErrors)[0];
    if (first && first !== "cart") document.getElementById(first)?.focus();
    showToast(state.fieldErrors.cart || "Completa los datos del pedido", true);
    return;
  }

  if (state.tipo_entrega === "delivery") {
    const precioVisto = cartDelivery();
    try {
      const zonas = await publicGet("/api/zonas-delivery/publicas/");
      state.zonas = Array.isArray(zonas) ? zonas : [];
    } catch (e) {
      showToast(e.message || "No se pudieron cargar las zonas de delivery", true);
      return;
    }
    const vigente = state.zonas.find((z) => String(z.id) === String(state.zonaId));
    if (!vigente) {
      state.zonaId = null;
      state.cartOpen = true;
      render();
      showToast("Esa zona ya no está. Elige otra.", true);
      return;
    }
    aplicarZona(vigente.id);
    if ((Number(vigente.precio) || 0) !== precioVisto) {
      state.cartOpen = true;
      render();
      showToast(
        `El delivery ahora es ${money(vigente.precio)}. Revisa el total y paga de nuevo.`,
        true
      );
      return;
    }
  }

  state.paying = true;
  render();
  try {
    const data = await publicPost("/api/pedidos/", {
      nombre_cliente: state.nombre.trim(),
      telefono: state.telefono.trim(),
      tipo_entrega: state.tipo_entrega,
      direccion: state.tipo_entrega === "delivery" ? state.direccion.trim() : "",
      zona_delivery: state.tipo_entrega === "delivery" ? zonaSeleccionada()?.id : null,
      notas: state.nota_pedido.trim(),
      detalles: buildDetallesPayload(),
    });
    if (!data?.url || !data?.token) {
      throw new Error("No se pudo abrir Webpay. Intenta de nuevo.");
    }
    redirigirWebpay(data.url, data.token);
  } catch (e) {
    state.paying = false;
    render();
    showToast(e.message || "No se pudo iniciar el pago", true);
  }
}

function setCantidad(index, delta) {
  const line = state.cart[index];
  if (!line) return;
  const next = Number(line.cantidad) + delta;
  if (next < 1) {
    state.cart.splice(index, 1);
  } else {
    line.cantidad = next;
  }
  render();
}

function abrirRollModal() {
  const envOpts = envolturasDisponibles(state.productos);
  if (!envOpts.length) {
    showToast("Falta cargar Arma tu Roll. Ejecuta seed_menu.", true);
    return;
  }
  state.rollConfig = {
    envoltura: null,
    relleno: null,
    acompanamientoTipo: null,
    vegetal: null,
    toppings: emptyToppingsState(),
    salsas: emptySalsasRollState(),
    cantidad: 1,
  };
  state.shawarmaConfig = null;
  state.gohanConfig = null;
  state.addModal = null;
  render({ preserveScroll: true });
}

function rollModalSnapshot(cfg) {
  const envOpts = envolturasDisponibles(state.productos);
  const topOpts = toppingsDisponibles(state.productos);
  const envSel = envOpts.find((e) => e.env === cfg.envoltura) || null;
  const tops = toppingsSeleccionados(cfg.toppings, topOpts);
  const salsas = salsasSeleccionadasRoll(cfg.salsas);
  const unit = precioUnitarioRoll({
    precioEnvoltura: envSel?.precio || 0,
    toppings: tops,
    salsas,
  });
  return { envOpts, topOpts, envSel, tops, salsas, unit, cant: cfg.cantidad || 1 };
}

function syncRollModalUI() {
  const cfg = state.rollConfig;
  if (!cfg) return;
  const { unit, cant, salsas } = rollModalSnapshot(cfg);
  const precioEl = document.querySelector("#roll-overlay .pedir-modal-price");
  if (precioEl) {
    precioEl.textContent = precioModalHeader(
      unit,
      salsas.length ? ` · ${salsas.length} salsa(s)` : ""
    );
  }
  const cantEl = document.getElementById("roll-cant-val");
  if (cantEl) cantEl.textContent = String(cant);
  const btn = document.getElementById("btn-confirmar-roll");
  if (btn) {
    btn.disabled = !rollConfigCompleta(cfg);
    btn.textContent = `Agregar · ${money(unit * cant)}`;
  }
  document.querySelectorAll("[data-roll-env]").forEach((el) => {
    el.classList.toggle("is-on", el.dataset.rollEnv === cfg.envoltura);
  });
  document.querySelectorAll("[data-roll-relleno]").forEach((el) => {
    el.classList.toggle("is-on", el.dataset.rollRelleno === cfg.relleno);
  });
  document.querySelectorAll("[data-roll-acomp]").forEach((el) => {
    const tipo = el.dataset.rollAcomp;
    const on =
      (tipo === "queso" && cfg.acompanamientoTipo === "queso") ||
      (tipo === "vegetal" &&
        cfg.acompanamientoTipo === "vegetal" &&
        cfg.vegetal === el.dataset.rollVegetal);
    el.classList.toggle("is-on", on);
  });
  document.querySelectorAll("[data-roll-topping]").forEach((el) => {
    el.classList.toggle("is-on", Boolean(cfg.toppings[el.dataset.rollTopping]));
  });
  document.querySelectorAll("[data-roll-salsa]").forEach((el) => {
    el.classList.toggle("is-on", Boolean(cfg.salsas[el.dataset.rollSalsa]));
  });
}

function abrirGohanModal() {
  const p = productoGohan(state.productos);
  if (!p) {
    showToast("Falta el producto Gohan. Ejecuta seed_menu.", true);
    return;
  }
  state.gohanConfig = { ...emptyGohanConfig(), producto: p };
  state.shawarmaConfig = null;
  state.rollConfig = null;
  state.addModal = null;
  render({ preserveScroll: true });
}

function gohanModalSnapshot(cfg) {
  const p = cfg.producto || productoGohan(state.productos);
  const furay = productoFuray(state.productos);
  const precioFuray = furay ? Number(furay.precio) || 0 : 0;
  const unit = precioUnitarioGohan(p?.precio, cfg.furay, precioFuray);
  return { p, furay, precioFuray, unit, cant: cfg.cantidad || 1 };
}

function syncGohanModalUI() {
  const cfg = state.gohanConfig;
  if (!cfg) return;
  const { unit, cant, precioFuray } = gohanModalSnapshot(cfg);
  const precioEl = document.querySelector("#gohan-overlay .pedir-modal-price");
  if (precioEl) {
    precioEl.textContent = precioModalHeader(
      unit,
      cfg.furay ? ` · incluye furay ${money(precioFuray)}` : ""
    );
  }
  const cantEl = document.getElementById("gohan-cant-val");
  if (cantEl) cantEl.textContent = String(cant);
  const btn = document.getElementById("btn-confirmar-gohan");
  if (btn) {
    btn.disabled = !gohanConfigCompleta(cfg);
    btn.textContent = `Agregar · ${money(unit * cant)}`;
  }
  document.querySelectorAll("[data-gohan-espol]").forEach((el) => {
    el.classList.toggle("is-on", el.dataset.gohanEspol === cfg.espolvoreado);
  });
  document.querySelectorAll("[data-gohan-proteina]").forEach((el) => {
    el.classList.toggle("is-on", el.dataset.gohanProteina === cfg.proteina);
  });
  document.getElementById("btn-gohan-furay")?.classList.toggle("is-on", Boolean(cfg.furay));
  document.querySelectorAll("[data-gohan-veg]").forEach((el) => {
    el.classList.toggle("is-on", (cfg.vegetales || []).includes(el.dataset.gohanVeg));
  });
  const vegHint = document.getElementById("gohan-veg-hint");
  if (vegHint) {
    const n = (cfg.vegetales || []).length;
    vegHint.textContent = n ? ` · ${n}/2` : "";
  }
  if (!cfg.vegError) clearGohanVegError();
}

function showGohanVegError(msg) {
  if (state.gohanConfig) state.gohanConfig.vegError = msg;
  const err = document.getElementById("gohan-veg-error");
  if (err) {
    err.textContent = msg;
    err.classList.add("is-error");
  }
}

function clearGohanVegError() {
  if (state.gohanConfig) state.gohanConfig.vegError = null;
  const err = document.getElementById("gohan-veg-error");
  if (err) {
    err.textContent = "";
    err.classList.remove("is-error");
  }
}

function abrirProducto(p) {
  if (p?._virtualRoll || p?.id === "arma-tu-roll") {
    abrirRollModal();
    return;
  }
  if (esGohan(p)) {
    abrirGohanModal();
    return;
  }
  if (esShawarma(p)) {
    const parsed = parseIngredientesShawarma(p);
    state.shawarmaConfig = {
      producto: p,
      ings: parsed.fijos.map((n) => ({ nombre: n, incluido: true })),
      eligeProteina: parsed.eligeProteina,
      proteinaOpciones: parsed.proteinaOpciones,
      proteina: parsed.eligeProteina ? parsed.proteinaOpciones[0] : "",
      masa: MASA_DEFAULT,
      salsas: Object.fromEntries(SALSAS_SHAWARMA.map((s) => [s, false])),
      cantidad: 1,
    };
    state.addModal = null;
    state.rollConfig = null;
    state.gohanConfig = null;
  } else {
    state.addModal = {
      producto: p,
      cantidad: 1,
      nota: "",
      conPalta: false,
      salsas: esTabla(p) ? emptySalsasRollState() : null,
    };
    state.shawarmaConfig = null;
    state.rollConfig = null;
    state.gohanConfig = null;
  }
  render({ preserveScroll: true });
}

function syncAddModalUI() {
  const m = state.addModal;
  if (!m) return;
  const salsas = m.salsas ? salsasSeleccionadasRoll(m.salsas) : [];
  const unit =
    Number(m.producto.precio) +
    (m.conPalta ? PRECIO_PALTA_EXTRA : 0) +
    salsas.length * PRECIO_SALSA_EXTRA_ROLL;
  const cant = m.cantidad || 1;
  const precioEl = document.querySelector("#add-overlay .pedir-modal-price");
  if (precioEl) precioEl.textContent = money(unit);
  const cantEl = document.getElementById("add-cant-val");
  if (cantEl) cantEl.textContent = String(cant);
  const btn = document.getElementById("btn-confirmar-add");
  if (btn) btn.textContent = `Agregar · ${money(unit * cant)}`;
  const cb = document.getElementById("add-palta");
  if (cb && cb.checked !== Boolean(m.conPalta)) cb.checked = Boolean(m.conPalta);
  document.querySelectorAll("[data-tabla-salsa]").forEach((el) => {
    el.classList.toggle("is-on", Boolean(m.salsas?.[el.dataset.tablaSalsa]));
  });
}

function syncShawarmaModalUI() {
  const cfg = state.shawarmaConfig;
  if (!cfg) return;
  const salsasSel = SALSAS_SHAWARMA.filter((s) => cfg.salsas[s]);
  const extras = extrasSalsaCount(salsasSel);
  const unit = precioUnitarioShawarma(cfg.producto.precio, salsasSel);
  const cant = cfg.cantidad || 1;
  const precioEl = document.querySelector("#shawarma-overlay .pedir-modal-price");
  if (precioEl) {
    precioEl.textContent = precioModalHeader(
      unit,
      extras ? ` · incluye ${extras} salsa(s) extra` : ""
    );
  }
  const cantEl = document.getElementById("shawarma-cant-val");
  if (cantEl) cantEl.textContent = String(cant);
  const btn = document.getElementById("btn-confirmar-shawarma");
  if (btn) btn.textContent = `Agregar · ${money(unit * cant)}`;
  document.querySelectorAll("[data-masa]").forEach((el) => {
    el.classList.toggle("is-on", (cfg.masa || MASA_DEFAULT) === el.dataset.masa);
  });
  document.querySelectorAll("[data-proteina]").forEach((el) => {
    el.classList.toggle("is-on", cfg.proteina === el.dataset.proteina);
  });
  document.querySelectorAll("[data-toggle-shawarma-ing]").forEach((el) => {
    const i = Number(el.dataset.toggleShawarmaIng);
    const ing = cfg.ings?.[i];
    if (ing) el.classList.toggle("is-on", Boolean(ing.incluido));
  });
  document.querySelectorAll("[data-salsa-btn]").forEach((el) => {
    el.classList.toggle("is-on", Boolean(cfg.salsas[el.dataset.salsaBtn]));
  });
}

function renderResultado() {
  const r = state.resultado;
  const ok = r.pago === "ok";
  const msgs = {
    ok: "Tu pago con Webpay fue autorizado. El local ya recibió el pedido.",
    anulado: "Anulaste la compra en Webpay. No se cobró nada.",
    rechazado: "El banco rechazó el pago. No se cobró nada.",
    error: "No se pudo confirmar el pago. Si te cobraron, contacta al local con tu comprobante.",
  };
  return `
    <div class="pedir-app pedir-result-screen">
      <div class="pedir-result-card ${ok ? "is-ok" : "is-fail"}">
        <p class="pedir-result-brand">el Tenedor</p>
        <p class="pedir-result-script">General del Canto</p>
        <h1>${ok ? "¡Pedido confirmado!" : "Compra no realizada"}</h1>
        <p>${escapeHtml(msgs[r.pago] || msgs.error)}</p>
        ${ok ? `<p class="pedir-result-num">Pedido <strong>#${escapeHtml(r.pedido)}</strong></p>` : ""}
        <button type="button" class="pedir-btn-primary" id="btn-nuevo-pedido">
          ${ok ? "Hacer otro pedido" : "Volver a la carta"}
        </button>
      </div>
    </div>
  `;
}

function renderProductRow(p) {
  const tone = CAT_TONE[p.categoria] || "tone-mist";
  const needsConfig =
    esShawarma(p) ||
    esTabla(p) ||
    esGohan(p) ||
    p._virtualRoll ||
    p.categoria === "ceviches";
  const titulo = esGohan(p) ? "Arma tu Gohan" : p.nombre;
  const precioTxt = p._virtualRoll ? `Desde ${money(p.precio)}` : money(p.precio);
  return `
    <article class="pedir-item ${tone}" data-add="${p.id}">
      <div class="pedir-item-swatch" aria-hidden="true"></div>
      <div class="pedir-item-body">
        <h3>${escapeHtml(titulo)}</h3>
        ${p.descripcion ? `<p>${escapeHtml(p.descripcion)}</p>` : ""}
        <div class="pedir-item-price">${precioTxt}</div>
      </div>
      <button type="button" class="pedir-item-add" data-add="${p.id}" aria-label="Agregar ${escapeHtml(titulo)}">
        <span aria-hidden="true">${needsConfig ? "⋯" : "+"}</span>
      </button>
    </article>
  `;
}

function renderMenu() {
  const secciones = productosPorSeccion();
  if (!secciones.length || secciones.every((s) => !s.items.length)) {
    return `<div class="pedir-empty">No hay productos con ese filtro. Prueba otra categoría o limpia la búsqueda.</div>`;
  }
  return secciones
    .map(
      (sec) => `
    <section class="pedir-section" id="sec-${escapeHtml(sec.id)}">
      <div class="pedir-section-head">
        <h2>${escapeHtml(sec.label)}</h2>
        <span class="pedir-section-count">${sec.items.length}</span>
      </div>
      <div class="pedir-item-list">
        ${sec.items.map(renderProductRow).join("")}
      </div>
    </section>`
    )
    .join("");
}

function renderCartLines() {
  if (!state.cart.length) {
    return `
      <div class="pedir-cart-empty">
        <strong>Todavía no hay nada aquí</strong>
        <p>Cuando elijas algo rico, aparece en tu pedido.</p>
      </div>`;
  }
  return `
    <ul class="pedir-cart-list">
      ${state.cart
        .map(
          (l, i) => `
        <li class="pedir-cart-line">
          <div class="pedir-cart-line-info">
            <strong>${escapeHtml(l.nombre)}</strong>
            ${l.shawarma ? `<span>${escapeHtml(l.shawarma)}</span>` : ""}
            ${l.rollArmado ? `<span>${escapeHtml(l.rollArmado)}</span>` : ""}
            ${l.gohanArmado ? `<span>${escapeHtml(l.gohanArmado)}</span>` : ""}
            ${l.nota ? `<span>Nota: ${escapeHtml(l.nota)}</span>` : ""}
            <em>${money(l.precio)} c/u</em>
          </div>
          <div class="pedir-cart-line-actions">
            <div class="pedir-qty" role="group" aria-label="Cantidad">
              <button type="button" data-qty-minus="${i}" aria-label="Menos">−</button>
              <span>${l.cantidad}</span>
              <button type="button" data-qty-plus="${i}" aria-label="Más">+</button>
            </div>
            <strong>${money(l.precio * l.cantidad)}</strong>
          </div>
        </li>`
        )
        .join("")}
    </ul>`;
}

function fieldClass(name) {
  return state.fieldErrors[name] ? "pedir-field has-error" : "pedir-field";
}

function renderCheckout() {
  const err = state.fieldErrors;
  return `
    <div class="pedir-checkout">
      <h3>Datos para el pedido</h3>
      <div class="pedir-entrega-toggle" role="group" aria-label="Tipo de entrega">
        <button type="button" class="${state.tipo_entrega === "retiro" ? "is-on" : ""}" data-entrega="retiro">
          Retiro
        </button>
        <button type="button" class="${state.tipo_entrega === "delivery" ? "is-on" : ""}" data-entrega="delivery">
          Delivery
        </button>
      </div>
      <div class="${fieldClass("nombre")}">
        <label for="nombre">Nombre</label>
        <input id="nombre" value="${escapeHtml(state.nombre)}" autocomplete="name" placeholder="Tu nombre" />
        ${err.nombre ? `<small>${escapeHtml(err.nombre)}</small>` : ""}
      </div>
      <div class="${fieldClass("telefono")}">
        <label for="telefono">Teléfono</label>
        <input id="telefono" value="${escapeHtml(state.telefono)}" inputmode="tel" autocomplete="tel" placeholder="+56 9 …" />
        ${err.telefono ? `<small>${escapeHtml(err.telefono)}</small>` : ""}
      </div>
      ${
        state.tipo_entrega === "delivery"
          ? `<div class="${fieldClass("zona")}">
              <span class="pedir-label">Zona</span>
              ${
                zonasActivas().length
                  ? `<div class="pedir-zonas">
                      ${zonasActivas()
                        .map(
                          (z) => `
                        <button type="button" class="pedir-zona ${String(state.zonaId) === String(z.id) ? "is-on" : ""}" data-zona="${z.id}">
                          <strong><span>${escapeHtml(z.nombre)}</span><span>${money(z.precio)}</span></strong>
                          ${z.descripcion ? `<small>${escapeHtml(z.descripcion)}</small>` : ""}
                        </button>`
                        )
                        .join("")}
                    </div>`
                  : `<small>No hay zonas de delivery activas.</small>`
              }
              ${err.zona ? `<small>${escapeHtml(err.zona)}</small>` : ""}
            </div>
            <div class="${fieldClass("direccion")}">
              <label for="direccion">Dirección</label>
              <input id="direccion" value="${escapeHtml(state.direccion)}" autocomplete="street-address" placeholder="Calle, número, depto…" />
              ${err.direccion ? `<small>${escapeHtml(err.direccion)}</small>` : ""}
            </div>`
          : ""
      }
      <div class="pedir-field">
        <label for="nota_pedido">Nota (opcional)</label>
        <textarea id="nota_pedido" rows="2" placeholder="Sin cubiertos, tocar timbre…">${escapeHtml(state.nota_pedido)}</textarea>
      </div>
    </div>
  `;
}

function renderCartDrawer() {
  const n = cartItemsCount();
  return `
    <div class="pedir-drawer-backdrop ${state.cartOpen ? "is-open" : ""}" id="cart-backdrop" ${state.cartOpen ? "" : "hidden"}></div>
    <aside class="pedir-drawer ${state.cartOpen ? "is-open" : ""}" aria-hidden="${state.cartOpen ? "false" : "true"}">
      <header class="pedir-drawer-head">
        <div>
          <h2>Tu pedido</h2>
          <p>${n ? `${n} producto${n === 1 ? "" : "s"}` : "Vacío"}</p>
        </div>
        <button type="button" class="pedir-icon-btn" id="btn-cerrar-cart" aria-label="Cerrar">×</button>
      </header>
      <div class="pedir-drawer-body">
        ${renderCartLines()}
        ${state.cart.length ? renderCheckout() : ""}
      </div>
      ${
        state.cart.length
          ? `<footer class="pedir-drawer-foot">
              <div class="pedir-totals">
                <div><span>Subtotal</span><span>${money(cartSubtotal())}</span></div>
                ${
                  state.tipo_entrega === "delivery"
                    ? `<div><span>Delivery${zonaSeleccionada() ? ` · ${escapeHtml(zonaSeleccionada().nombre)}` : ""}</span><span>${money(cartDelivery())}</span></div>`
                    : ""
                }
                <div class="is-total"><span>Total</span><strong>${money(cartTotal())}</strong></div>
              </div>
              <p class="pedir-pay-hint">Pagas con Webpay. Si anulas en Transbank, no se cobra ni llega el pedido.</p>
              ${
                !pedidosAbiertos()
                  ? `<p class="pedir-closed-msg">${escapeHtml(
                      state.horario.mensaje || "Ahora no recibimos pedidos online"
                    )}</p>`
                  : ""
              }
              <button type="button" class="pedir-btn-primary" id="btn-pagar" ${
                state.paying || !pedidosAbiertos() ? "disabled" : ""
              }>
                ${
                  state.paying
                    ? "Abriendo Webpay…"
                    : !pedidosAbiertos()
                      ? "Cerrado ahora"
                      : `Pagar con Webpay · ${money(cartTotal())}`
                }
              </button>
            </footer>`
          : ""
      }
    </aside>
  `;
}

function renderAddModal() {
  const m = state.addModal;
  if (!m) return "";
  const p = m.producto;
  const salsasSel = m.salsas ? salsasSeleccionadasRoll(m.salsas) : [];
  const unit =
    Number(p.precio) +
    (m.conPalta ? PRECIO_PALTA_EXTRA : 0) +
    salsasSel.length * PRECIO_SALSA_EXTRA_ROLL;
  return `
    <div class="pedir-modal-backdrop is-open" id="add-overlay" role="dialog" aria-modal="true">
      <div class="pedir-modal">
        <header>
          <div>
            <p class="pedir-modal-kicker">${escapeHtml(CAT_LABEL[p.categoria] || p.categoria)}</p>
            <h2>${escapeHtml(p.nombre)}</h2>
            <p class="pedir-modal-price">${money(unit)}</p>
          </div>
          <button type="button" class="pedir-icon-btn" id="btn-cerrar-add" aria-label="Cerrar">×</button>
        </header>
        <div class="pedir-modal-body">
          ${p.descripcion ? `<p class="pedir-modal-desc">${escapeHtml(p.descripcion)}</p>` : ""}
          ${
            esTabla(p)
              ? `<p class="pedir-modal-note">Puedes dejar una nota; el local confirma cambios de rolls.</p>
                <div class="pedir-opt">
                  <p><strong>Salsas</strong> <span>· ${money(PRECIO_SALSA_EXTRA_ROLL)} c/u</span></p>
                  <div class="pedir-chips">
                    ${SALSAS_ROLL.map(
                      (s) => `
                      <button type="button" class="pedir-chip ${
                        m.salsas?.[s] ? "is-on" : ""
                      }" data-tabla-salsa="${escapeHtml(s)}">${escapeHtml(s)}</button>`
                    ).join("")}
                  </div>
                  ${
                    salsasSel.length
                      ? `<p class="pedir-modal-note">${salsasSel.length} salsa(s)</p>`
                      : ""
                  }
                </div>`
              : ""
          }
          ${
            p.categoria === "ceviches"
              ? `<label class="pedir-check">
                  <input type="checkbox" id="add-palta" ${m.conPalta ? "checked" : ""}/>
                  <span>Palta extra <em>+${money(PRECIO_PALTA_EXTRA)}</em></span>
                </label>`
              : ""
          }
          <div class="pedir-field">
            <label>Cantidad</label>
            <div class="pedir-qty pedir-qty-lg">
              <button type="button" id="add-cant-minus" aria-label="Menos">−</button>
              <span id="add-cant-val">${m.cantidad}</span>
              <button type="button" id="add-cant-plus" aria-label="Más">+</button>
            </div>
          </div>
          <div class="pedir-field">
            <label for="add-nota">Nota (opcional)</label>
            <textarea id="add-nota" rows="2" placeholder="Sin cebolla, poco picante…">${escapeHtml(m.nota || "")}</textarea>
          </div>
        </div>
        <footer>
          <button type="button" class="pedir-btn-primary" id="btn-confirmar-add">
            Agregar · ${money(unit * m.cantidad)}
          </button>
        </footer>
      </div>
    </div>
  `;
}

function renderShawarmaModal() {
  const cfg = state.shawarmaConfig;
  if (!cfg) return "";
  const p = cfg.producto;
  const salsasSel = SALSAS_SHAWARMA.filter((s) => cfg.salsas[s]);
  const extras = extrasSalsaCount(salsasSel);
  const unit = precioUnitarioShawarma(p.precio, salsasSel);
  const cant = cfg.cantidad || 1;
  return `
    <div class="pedir-modal-backdrop is-open" id="shawarma-overlay" role="dialog" aria-modal="true">
      <div class="pedir-modal pedir-modal-wide">
        <header>
          <div>
            <p class="pedir-modal-kicker">Personalizar</p>
            <h2>${escapeHtml(p.nombre)}</h2>
            <p class="pedir-modal-price">${precioModalHeader(
              unit,
              extras ? ` · incluye ${extras} salsa(s) extra` : ""
            )}</p>
          </div>
          <button type="button" class="pedir-icon-btn" id="btn-cerrar-shawarma" aria-label="Cerrar">×</button>
        </header>
        <div class="pedir-modal-body">
          <div class="pedir-opt">
            <p><strong>Masa</strong></p>
            <div class="pedir-chips">
              ${MASAS_SHAWARMA.map(
                (m) => `
                <button type="button" class="pedir-chip ${
                  (cfg.masa || MASA_DEFAULT) === m.id ? "is-on" : ""
                }" data-masa="${escapeHtml(m.id)}">${escapeHtml(m.label)}${
                  m.detalle ? ` · ${escapeHtml(m.detalle)}` : ""
                }</button>`
              ).join("")}
            </div>
          </div>
          ${
            cfg.eligeProteina
              ? `<div class="pedir-opt">
                  <p><strong>Proteína</strong></p>
                  <div class="pedir-chips">
                    ${cfg.proteinaOpciones
                      .map(
                        (op) => `
                      <button type="button" class="pedir-chip ${cfg.proteina === op ? "is-on" : ""}" data-proteina="${escapeHtml(op)}">${escapeHtml(op)}</button>`
                      )
                      .join("")}
                  </div>
                </div>`
              : ""
          }
          <div class="pedir-opt">
            <p><strong>Ingredientes</strong></p>
            <div class="pedir-chips">
              ${cfg.ings
                .map(
                  (ing, iIdx) => `
                <button type="button" class="pedir-chip ${ing.incluido ? "is-on" : ""}" data-toggle-shawarma-ing="${iIdx}">
                  ${escapeHtml(ing.nombre)}
                </button>`
                )
                .join("")}
            </div>
          </div>
          <div class="pedir-opt">
            <p><strong>Salsas</strong> <span>· 1 incluida · extra ${money(PRECIO_SALSA_EXTRA)}</span></p>
            <div class="pedir-chips">
              ${SALSAS_SHAWARMA.map(
                (s) => `
                <button type="button" class="pedir-chip ${cfg.salsas[s] ? "is-on" : ""}" data-salsa-btn="${escapeHtml(s)}">${escapeHtml(s)}</button>`
              ).join("")}
            </div>
            ${extras ? `<p class="pedir-modal-note">${extras} salsa(s) extra</p>` : ""}
          </div>
          <div class="pedir-field">
            <label>Cantidad</label>
            <div class="pedir-qty pedir-qty-lg">
              <button type="button" id="shawarma-cant-minus" aria-label="Menos">−</button>
              <span id="shawarma-cant-val">${cant}</span>
              <button type="button" id="shawarma-cant-plus" aria-label="Más">+</button>
            </div>
          </div>
        </div>
        <footer>
          <button type="button" class="pedir-btn-primary" id="btn-confirmar-shawarma">
            Agregar · ${money(unit * cant)}
          </button>
        </footer>
      </div>
    </div>
  `;
}

function renderRollModal() {
  const cfg = state.rollConfig;
  if (!cfg) return "";
  const { envOpts, topOpts, unit, cant, salsas } = rollModalSnapshot(cfg);
  const completa = rollConfigCompleta(cfg);
  return `
    <div class="pedir-modal-backdrop is-open" id="roll-overlay" role="dialog" aria-modal="true">
      <div class="pedir-modal pedir-modal-wide">
        <header>
          <div>
            <p class="pedir-modal-kicker">Arma tu Roll</p>
            <h2>Personalizar roll</h2>
            <p class="pedir-modal-price">${precioModalHeader(
              unit,
              salsas.length ? ` · ${salsas.length} salsa(s)` : ""
            )}</p>
          </div>
          <button type="button" class="pedir-icon-btn" id="btn-cerrar-roll" aria-label="Cerrar">×</button>
        </header>
        <div class="pedir-modal-body">
          <div class="pedir-opt">
            <p><strong>Envoltura</strong></p>
            <div class="pedir-chips">
              ${envOpts
                .map(
                  (e) => `
                <button type="button" class="pedir-chip ${
                  cfg.envoltura === e.env ? "is-on" : ""
                }" data-roll-env="${escapeHtml(e.env)}">${escapeHtml(e.env)} · ${money(
                    e.precio
                  )}</button>`
                )
                .join("")}
            </div>
          </div>
          <div class="pedir-opt">
            <p><strong>Carne o vegetal</strong></p>
            <div class="pedir-chips">
              ${RELLENOS_ROLL.map(
                (r) => `
                <button type="button" class="pedir-chip ${
                  cfg.relleno === r ? "is-on" : ""
                }" data-roll-relleno="${escapeHtml(r)}">${escapeHtml(r)}</button>`
              ).join("")}
            </div>
          </div>
          <div class="pedir-opt">
            <p><strong>Acompañamiento</strong></p>
            <div class="pedir-chips">
              <button type="button" class="pedir-chip ${
                cfg.acompanamientoTipo === "queso" ? "is-on" : ""
              }" data-roll-acomp="queso">${escapeHtml(ACOMP_QUESO)}</button>
              ${VEGETALES_ROLL.map(
                (v) => `
                <button type="button" class="pedir-chip ${
                  cfg.acompanamientoTipo === "vegetal" && cfg.vegetal === v
                    ? "is-on"
                    : ""
                }" data-roll-acomp="vegetal" data-roll-vegetal="${escapeHtml(
                  v
                )}">${escapeHtml(v)}</button>`
              ).join("")}
            </div>
          </div>
          ${
            topOpts.length
              ? `<div class="pedir-opt">
            <p><strong>Topping</strong></p>
            <div class="pedir-chips">
              ${topOpts
                .map(
                  (t) => `
                <button type="button" class="pedir-chip ${
                  cfg.toppings[t.key] ? "is-on" : ""
                }" data-roll-topping="${escapeHtml(t.key)}">${escapeHtml(
                    t.label
                  )} · +${money(t.precio)}</button>`
                )
                .join("")}
            </div>
          </div>`
              : ""
          }
          <div class="pedir-opt">
            <p><strong>Salsas extras</strong> <span>· ${money(PRECIO_SALSA_EXTRA_ROLL)} c/u</span></p>
            <div class="pedir-chips">
              ${SALSAS_ROLL.map(
                (s) => `
                <button type="button" class="pedir-chip ${
                  cfg.salsas[s] ? "is-on" : ""
                }" data-roll-salsa="${escapeHtml(s)}">${escapeHtml(s)}</button>`
              ).join("")}
            </div>
            ${salsas.length ? `<p class="pedir-modal-note">${salsas.length} salsa(s)</p>` : ""}
          </div>
          <div class="pedir-field">
            <label>Cantidad</label>
            <div class="pedir-qty pedir-qty-lg">
              <button type="button" id="roll-cant-minus" aria-label="Menos">−</button>
              <span id="roll-cant-val">${cant}</span>
              <button type="button" id="roll-cant-plus" aria-label="Más">+</button>
            </div>
          </div>
        </div>
        <footer>
          <button type="button" class="pedir-btn-primary" id="btn-confirmar-roll" ${
            completa ? "" : "disabled"
          }>
            Agregar · ${money(unit * cant)}
          </button>
        </footer>
      </div>
    </div>
  `;
}

function renderGohanModal() {
  const cfg = state.gohanConfig;
  if (!cfg) return "";
  const { unit, cant, precioFuray, furay } = gohanModalSnapshot(cfg);
  const completa = gohanConfigCompleta(cfg);
  const vegCount = (cfg.vegetales || []).length;
  return `
    <div class="pedir-modal-backdrop is-open" id="gohan-overlay" role="dialog" aria-modal="true">
      <div class="pedir-modal pedir-modal-wide">
        <header>
          <div>
            <p class="pedir-modal-kicker">Arma tu Gohan</p>
            <h2>Personalizar gohan</h2>
            <p class="pedir-modal-price">${precioModalHeader(
              unit,
              cfg.furay ? ` · incluye furay ${money(precioFuray)}` : ""
            )}</p>
          </div>
          <button type="button" class="pedir-icon-btn" id="btn-cerrar-gohan" aria-label="Cerrar">×</button>
        </header>
        <div class="pedir-modal-body">
          <p class="pedir-modal-note">Incluye arroz, queso phila, salsa y espolvoreado</p>
          <div class="pedir-opt">
            <p><strong>Espolvoreado</strong></p>
            <div class="pedir-chips">
              ${ESPOLVOREADOS_GOHAN.map(
                (e) => `
                <button type="button" class="pedir-chip ${
                  cfg.espolvoreado === e ? "is-on" : ""
                }" data-gohan-espol="${escapeHtml(e)}">${escapeHtml(e)}</button>`
              ).join("")}
            </div>
          </div>
          <div class="pedir-opt">
            <p><strong>Proteína o vegetal</strong></p>
            <div class="pedir-chips">
              ${PROTEINAS_GOHAN.map(
                (r) => `
                <button type="button" class="pedir-chip ${
                  cfg.proteina === r ? "is-on" : ""
                }" data-gohan-proteina="${escapeHtml(r)}">${escapeHtml(r)}</button>`
              ).join("")}
            </div>
            ${
              furay
                ? `<div class="pedir-chips" style="margin-top:8px">
                <button type="button" class="pedir-chip ${
                  cfg.furay ? "is-on" : ""
                }" id="btn-gohan-furay">Furay · +${money(precioFuray)}</button>
              </div>`
                : ""
            }
          </div>
          <div class="pedir-opt">
            <p><strong>Vegetales</strong><span id="gohan-veg-hint">${
              vegCount ? ` · ${vegCount}/2` : ""
            }</span> <span>· elige 2</span></p>
            <p class="pedir-opt-msg${cfg.vegError ? " is-error" : ""}" id="gohan-veg-error" role="alert">${
              cfg.vegError ? escapeHtml(cfg.vegError) : ""
            }</p>
            <div class="pedir-chips">
              ${VEGETALES_GOHAN.map(
                (v) => `
                <button type="button" class="pedir-chip ${
                  (cfg.vegetales || []).includes(v) ? "is-on" : ""
                }" data-gohan-veg="${escapeHtml(v)}">${escapeHtml(v)}</button>`
              ).join("")}
            </div>
          </div>
          <div class="pedir-field">
            <label>Cantidad</label>
            <div class="pedir-qty pedir-qty-lg">
              <button type="button" id="gohan-cant-minus" aria-label="Menos">−</button>
              <span id="gohan-cant-val">${cant}</span>
              <button type="button" id="gohan-cant-plus" aria-label="Más">+</button>
            </div>
          </div>
        </div>
        <footer>
          <button type="button" class="pedir-btn-primary" id="btn-confirmar-gohan" ${
            completa ? "" : "disabled"
          }>
            Agregar · ${money(unit * cant)}
          </button>
        </footer>
      </div>
    </div>
  `;
}

function renderLoading() {
  return `
    <div class="pedir-app">
      <header class="pedir-top">
        <div class="pedir-brand">
          <span class="pedir-brush">el Tenedor</span>
          <span class="pedir-script">General del Canto</span>
        </div>
      </header>
      <div class="pedir-loading">
        <div class="pedir-skeleton"></div>
        <div class="pedir-skeleton"></div>
        <div class="pedir-skeleton"></div>
      </div>
    </div>
  `;
}

function renderError() {
  return `
    <div class="pedir-app">
      <div class="pedir-error-box">
        <h1>No pudimos cargar la carta</h1>
        <p>${escapeHtml(state.error)}</p>
        <button type="button" class="pedir-btn-primary" id="btn-reintentar">Reintentar</button>
      </div>
    </div>
  `;
}

function renderMain() {
  if (state.resultado) return renderResultado();
  if (state.loading) return renderLoading();
  if (state.error) return renderError();

  const n = cartItemsCount();
  const paintClass = state.firstPaint ? "pedir-app is-first-paint" : "pedir-app";
  return `
    <div class="${paintClass}">
      <header class="pedir-top">
        <div class="pedir-brand">
          <span class="pedir-brush">el Tenedor</span>
          <span class="pedir-script">General del Canto</span>
        </div>
        <div class="pedir-top-actions">
          <div class="pedir-entrega-mini" role="group" aria-label="Entrega">
            <button type="button" class="${state.tipo_entrega === "retiro" ? "is-on" : ""}" data-entrega="retiro">Retiro</button>
            <button type="button" class="${state.tipo_entrega === "delivery" ? "is-on" : ""}" data-entrega="delivery">Delivery</button>
          </div>
          <button type="button" class="pedir-cart-btn" id="btn-toggle-cart">
            <span>Pedido</span>
            <strong>${n ? `${n} · ${money(cartTotal())}` : money(0)}</strong>
          </button>
        </div>
      </header>

      <div class="pedir-hero">
        <p class="pedir-hero-kicker">Para llevar · Punta Arenas</p>
        <h1 class="pedir-hero-brand">el Tenedor</h1>
        <p class="pedir-hero-script">General del Canto</p>
        <p class="pedir-hero-lead">${
          pedidosAbiertos()
            ? "¿Qué se te antoja hoy? Arma tu pedido con calma y paga seguro con Webpay."
            : escapeHtml(
                state.horario.mensaje ||
                  "Ahora no recibimos pedidos online. Horario: lunes a sábado de 12:00 a 15:45 y de 18:00 a 22:45."
              )
        }</p>
        ${
          pedidosAbiertos() && state.horario.horario
            ? `<p class="pedir-hours">${escapeHtml(state.horario.horario)}</p>`
            : ""
        }
      </div>
      ${
        !pedidosAbiertos()
          ? `<div class="pedir-closed-banner" role="status">${escapeHtml(
              state.horario.mensaje || "Ahora no recibimos pedidos online"
            )}</div>`
          : ""
      }

      <div class="pedir-controls">
        <div class="pedir-search">
          <input id="buscar" type="search" placeholder="Buscar un plato, bebida…" value="${escapeHtml(state.busqueda)}" />
        </div>
        <nav class="pedir-cats" aria-label="Categorías">
          <button type="button" data-cat="todas" class="${state.categoria === "todas" ? "is-on" : ""}">Todas</button>
          ${CATEGORIAS.map(
            ([id, label]) =>
              `<button type="button" data-cat="${id}" class="${state.categoria === id ? "is-on" : ""} ${CAT_TONE[id] || ""}">${label}</button>`
          ).join("")}
        </nav>
      </div>

      <main class="pedir-main">
        ${renderMenu()}
      </main>

      <!-- DATOS DE CONTACTO (Pie de página) -->
      <footer style="text-align: center; padding: 2rem 1rem 4rem; font-size: 0.85rem; opacity: 0.8; border-top: 1px solid rgba(0,0,0,0.08); margin-top: 2rem;">
        <p style="margin: 0 0 0.25rem;"><strong>El Tenedor — General del Canto</strong></p>
        <p style="margin: 0 0 0.25rem;">📍 Calle General Estanislao del Canto 326, Punta Arenas, Chile</p>
        <p style="margin: 0;">📱 Consultas / Pedidos: <a href="https://wa.me/+56954332805" target="_blank" style="color: inherit; font-weight: bold;">+56 9 5433 2805</a></p>
      </footer>

      ${
        n
          ? `<button type="button" class="pedir-fab" id="btn-fab-cart">
              Ver pedido · ${n} · ${money(cartTotal())}
            </button>`
          : ""
      }

      ${renderCartDrawer()}
      ${renderAddModal()}
      ${renderShawarmaModal()}
      ${renderRollModal()}
      ${renderGohanModal()}
    </div>
  `;
}

function render({ preserveScroll = true } = {}) {
  const y = preserveScroll ? window.scrollY : 0;
  app.innerHTML = renderMain();
  bind();
  if (preserveScroll) {
    window.scrollTo(0, y);
  }
  if (state.firstPaint && !state.loading && !state.error) {
    state.firstPaint = false;
  }
}

function bind() {
  document.getElementById("btn-nuevo-pedido")?.addEventListener("click", () => {
    state.resultado = null;
    state.cart = [];
    state.paying = false;
    state.fieldErrors = {};
    window.history.replaceState({}, "", window.location.pathname);
    render();
  });

  document.getElementById("btn-reintentar")?.addEventListener("click", () => loadCarta());

  const openCart = () => {
    syncFormFromDom();
    state.cartOpen = true;
    render();
  };
  const closeCart = () => {
    syncFormFromDom();
    state.cartOpen = false;
    render();
  };

  document.getElementById("btn-toggle-cart")?.addEventListener("click", () => {
    if (state.cartOpen) closeCart();
    else openCart();
  });
  document.getElementById("btn-fab-cart")?.addEventListener("click", openCart);
  document.getElementById("btn-cerrar-cart")?.addEventListener("click", closeCart);
  document.getElementById("cart-backdrop")?.addEventListener("click", closeCart);

  document.getElementById("buscar")?.addEventListener("input", (e) => {
    state.busqueda = e.target.value;
    // Re-render menu only would be nicer; full render keeps search value from state
    const focused = document.activeElement === e.target;
    const pos = e.target.selectionStart;
    render();
    if (focused) {
      const input = document.getElementById("buscar");
      input?.focus();
      try {
        input?.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    }
  });

  document.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.categoria = btn.dataset.cat;
      state.busqueda = "";
      render();
      document.querySelector(".pedir-main")?.scrollTo?.(0, 0);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  document.querySelectorAll("[data-entrega]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncFormFromDom();
      state.tipo_entrega = btn.dataset.entrega;
      delete state.fieldErrors.direccion;
      delete state.fieldErrors.zona;
      if (state.tipo_entrega === "delivery" && !zonaSeleccionada()) {
        const primera = zonasActivas()[0];
        if (primera) aplicarZona(primera.id);
      }
      if (state.tipo_entrega !== "delivery") state.zonaId = null;
      render();
    });
  });

  document.querySelectorAll("[data-zona]").forEach((btn) => {
    btn.addEventListener("click", () => {
      syncFormFromDom();
      aplicarZona(btn.dataset.zona);
      delete state.fieldErrors.zona;
      render();
    });
  });

  function productoDesdeAddId(id) {
    if (String(id) === "arma-tu-roll") return tarjetaArmaTuRoll(state.productos);
    return state.productos.find((x) => String(x.id) === String(id));
  }
  document.querySelectorAll(".pedir-item").forEach((row) => {
    row.addEventListener("click", (e) => {
      e.preventDefault();
      const p = productoDesdeAddId(row.dataset.add);
      if (p) abrirProducto(p);
    });
  });
  document.querySelectorAll(".pedir-item-add").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = productoDesdeAddId(btn.dataset.add);
      if (p) abrirProducto(p);
    });
  });

  document.querySelectorAll("[data-qty-minus]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setCantidad(Number(btn.dataset.qtyMinus), -1);
    });
  });
  document.querySelectorAll("[data-qty-plus]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setCantidad(Number(btn.dataset.qtyPlus), 1);
    });
  });

  document.getElementById("nombre")?.addEventListener("input", (e) => {
    state.nombre = e.target.value;
    delete state.fieldErrors.nombre;
  });
  document.getElementById("telefono")?.addEventListener("input", (e) => {
    state.telefono = e.target.value;
    delete state.fieldErrors.telefono;
  });
  document.getElementById("direccion")?.addEventListener("input", (e) => {
    state.direccion = e.target.value;
    delete state.fieldErrors.direccion;
  });
  document.getElementById("nota_pedido")?.addEventListener("input", (e) => {
    state.nota_pedido = e.target.value;
  });

  document.getElementById("btn-pagar")?.addEventListener("click", (e) => {
    e.preventDefault();
    pagar();
  });

  document.getElementById("btn-cerrar-add")?.addEventListener("click", (e) => {
    e.preventDefault();
    state.addModal = null;
    render({ preserveScroll: true });
  });
  document.getElementById("add-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "add-overlay") {
      state.addModal = null;
      render({ preserveScroll: true });
    }
  });
  document.getElementById("add-palta")?.addEventListener("change", (e) => {
    if (!state.addModal) return;
    state.addModal.conPalta = e.target.checked;
    state.addModal.nota = document.getElementById("add-nota")?.value || "";
    syncAddModalUI();
  });
  document.getElementById("add-cant-minus")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!state.addModal) return;
    state.addModal.cantidad = Math.max(1, state.addModal.cantidad - 1);
    state.addModal.nota = document.getElementById("add-nota")?.value || "";
    state.addModal.conPalta = Boolean(document.getElementById("add-palta")?.checked);
    syncAddModalUI();
  });
  document.getElementById("add-cant-plus")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!state.addModal) return;
    state.addModal.cantidad += 1;
    state.addModal.nota = document.getElementById("add-nota")?.value || "";
    state.addModal.conPalta = Boolean(document.getElementById("add-palta")?.checked);
    syncAddModalUI();
  });
  document.querySelectorAll("[data-tabla-salsa]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.addModal?.salsas) return;
      const salsa = btn.dataset.tablaSalsa;
      state.addModal.salsas[salsa] = !state.addModal.salsas[salsa];
      state.addModal.nota = document.getElementById("add-nota")?.value || "";
      syncAddModalUI();
    });
  });
  document.getElementById("btn-confirmar-add")?.addEventListener("click", (e) => {
    e.preventDefault();
    const m = state.addModal;
    if (!m) return;
    const nota = document.getElementById("add-nota")?.value || "";
    const conPalta =
      m.producto.categoria === "ceviches" &&
      Boolean(document.getElementById("add-palta")?.checked);
    const salsas = m.salsas ? salsasSeleccionadasRoll(m.salsas) : [];
    if (salsas.length > 0 && !idSalsaExtra()) {
      showToast("Falta el producto «Salsa extra» en la carta.", true);
      return;
    }
    const precio =
      Number(m.producto.precio) +
      (conPalta ? PRECIO_PALTA_EXTRA : 0) +
      salsas.length * PRECIO_SALSA_EXTRA_ROLL;
    const notaParts = [];
    if (nota.trim()) notaParts.push(nota.trim());
    if (salsas.length) notaParts.push(`Salsas: ${salsas.join(", ")}`);
    state.cart.push({
      producto: m.producto.id,
      nombre: m.producto.nombre + (conPalta ? " + palta" : ""),
      categoria: m.producto.categoria,
      precio,
      precioBase: Number(m.producto.precio),
      cantidad: m.cantidad,
      nota: notaParts.join(" · "),
      extrasPalta: conPalta ? 1 : 0,
      salsas,
      extrasSalsaRoll: salsas.length,
    });
    state.addModal = null;
    state.cartOpen = true;
    state.fieldErrors = {};
    render({ preserveScroll: true });
    showToast("Agregado al pedido");
  });

  document.getElementById("btn-cerrar-shawarma")?.addEventListener("click", (e) => {
    e.preventDefault();
    state.shawarmaConfig = null;
    render({ preserveScroll: true });
  });
  document.getElementById("shawarma-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "shawarma-overlay") {
      state.shawarmaConfig = null;
      render({ preserveScroll: true });
    }
  });
  document.querySelectorAll("[data-masa]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.shawarmaConfig) return;
      state.shawarmaConfig.masa = btn.dataset.masa;
      syncShawarmaModalUI();
    });
  });
  document.querySelectorAll("[data-proteina]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.shawarmaConfig) return;
      state.shawarmaConfig.proteina = btn.dataset.proteina;
      syncShawarmaModalUI();
    });
  });
  document.querySelectorAll("[data-toggle-shawarma-ing]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const i = Number(btn.dataset.toggleShawarmaIng);
      const ing = state.shawarmaConfig?.ings?.[i];
      if (!ing) return;
      ing.incluido = !ing.incluido;
      syncShawarmaModalUI();
    });
  });
  document.querySelectorAll("[data-salsa-btn]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const s = btn.dataset.salsaBtn;
      const cfg = state.shawarmaConfig;
      if (!cfg) return;
      cfg.salsas[s] = !cfg.salsas[s];
      syncShawarmaModalUI();
    });
  });
  document.getElementById("shawarma-cant-minus")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!state.shawarmaConfig) return;
    state.shawarmaConfig.cantidad = Math.max(1, (state.shawarmaConfig.cantidad || 1) - 1);
    syncShawarmaModalUI();
  });
  document.getElementById("shawarma-cant-plus")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!state.shawarmaConfig) return;
    state.shawarmaConfig.cantidad = (state.shawarmaConfig.cantidad || 1) + 1;
    syncShawarmaModalUI();
  });
  document.getElementById("btn-confirmar-shawarma")?.addEventListener("click", (e) => {
    e.preventDefault();
    const cfg = state.shawarmaConfig;
    if (!cfg) return;
    const ings = cfg.ings.filter((i) => i.incluido).map((i) => i.nombre);
    const salsas = SALSAS_SHAWARMA.filter((s) => cfg.salsas[s]);
    if (cfg.eligeProteina && !cfg.proteina) {
      showToast("Elige proteína", true);
      return;
    }
    if (!salsas.length) {
      showToast("Elige al menos una salsa", true);
      return;
    }
    const cant = cfg.cantidad || 1;
    const extras = extrasSalsaCount(salsas);
    const unit = precioUnitarioShawarma(cfg.producto.precio, salsas);
    state.cart.push({
      producto: cfg.producto.id,
      nombre: cfg.producto.nombre,
      categoria: cfg.producto.categoria,
      precio: unit,
      precioBase: Number(cfg.producto.precio),
      cantidad: cant,
      shawarma: labelShawarmaLinea({
        ingredientes: ings,
        proteina: cfg.proteina,
        salsas,
        extras,
        masa: cfg.masa || MASA_DEFAULT,
      }),
      salsas,
      extrasSalsa: extras,
      masa: cfg.masa || MASA_DEFAULT,
    });
    state.shawarmaConfig = null;
    state.cartOpen = true;
    state.fieldErrors = {};
    render({ preserveScroll: true });
    showToast("Agregado al pedido");
  });

  document.getElementById("btn-cerrar-roll")?.addEventListener("click", (e) => {
    e.preventDefault();
    state.rollConfig = null;
    render({ preserveScroll: true });
  });
  document.getElementById("roll-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "roll-overlay") {
      state.rollConfig = null;
      render({ preserveScroll: true });
    }
  });
  document.querySelectorAll("[data-roll-env]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.rollConfig) return;
      state.rollConfig.envoltura = btn.dataset.rollEnv;
      syncRollModalUI();
    });
  });
  document.querySelectorAll("[data-roll-relleno]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.rollConfig) return;
      state.rollConfig.relleno = btn.dataset.rollRelleno;
      syncRollModalUI();
    });
  });
  document.querySelectorAll("[data-roll-acomp]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.rollConfig) return;
      if (btn.dataset.rollAcomp === "queso") {
        state.rollConfig.acompanamientoTipo = "queso";
        state.rollConfig.vegetal = null;
      } else {
        state.rollConfig.acompanamientoTipo = "vegetal";
        state.rollConfig.vegetal = btn.dataset.rollVegetal;
      }
      syncRollModalUI();
    });
  });
  document.querySelectorAll("[data-roll-topping]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.rollConfig) return;
      const key = btn.dataset.rollTopping;
      state.rollConfig.toppings[key] = !state.rollConfig.toppings[key];
      syncRollModalUI();
    });
  });
  document.querySelectorAll("[data-roll-salsa]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.rollConfig) return;
      const salsa = btn.dataset.rollSalsa;
      state.rollConfig.salsas[salsa] = !state.rollConfig.salsas[salsa];
      syncRollModalUI();
    });
  });
  document.getElementById("roll-cant-minus")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!state.rollConfig) return;
    state.rollConfig.cantidad = Math.max(1, (state.rollConfig.cantidad || 1) - 1);
    syncRollModalUI();
  });
  document.getElementById("roll-cant-plus")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!state.rollConfig) return;
    state.rollConfig.cantidad = (state.rollConfig.cantidad || 1) + 1;
    syncRollModalUI();
  });
  document.getElementById("btn-confirmar-roll")?.addEventListener("click", (e) => {
    e.preventDefault();
    const cfg = state.rollConfig;
    if (!cfg || !rollConfigCompleta(cfg)) {
      showToast("Elige envoltura, relleno y acompañamiento", true);
      return;
    }
    const { envSel, tops, salsas, unit } = rollModalSnapshot(cfg);
    if (!envSel) {
      showToast("Falta la envoltura en la carta. Ejecuta seed_menu.", true);
      return;
    }
    if (salsas.length > 0 && !idSalsaExtra()) {
      showToast("Falta el producto «Salsa extra» en la carta.", true);
      return;
    }
    const cant = cfg.cantidad || 1;
    const toppingsLabels = tops.map((t) => t.label);
    state.cart.push({
      producto: envSel.producto.id,
      nombre: "Arma tu Roll",
      categoria: "rolls",
      precio: unit,
      precioBase: Number(envSel.precio),
      cantidad: cant,
      rollArmado: labelRollArmado({
        envoltura: cfg.envoltura,
        relleno: cfg.relleno,
        acompanamientoTipo: cfg.acompanamientoTipo,
        vegetal: cfg.vegetal,
        toppingsLabels,
        salsas,
      }),
      salsas,
      extrasSalsaRoll: salsas.length,
      toppingsDetalle: tops.map((t) => ({
        id: t.productoObj.id,
        nombre: t.producto,
        label: t.label,
        precio: t.precio,
      })),
    });
    state.rollConfig = null;
    state.cartOpen = true;
    state.fieldErrors = {};
    render({ preserveScroll: true });
    showToast("Agregado al pedido");
  });

  document.getElementById("btn-cerrar-gohan")?.addEventListener("click", (e) => {
    e.preventDefault();
    state.gohanConfig = null;
    render({ preserveScroll: true });
  });
  document.getElementById("gohan-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "gohan-overlay") {
      state.gohanConfig = null;
      render({ preserveScroll: true });
    }
  });
  document.querySelectorAll("[data-gohan-espol]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.gohanConfig) return;
      state.gohanConfig.espolvoreado = btn.dataset.gohanEspol;
      syncGohanModalUI();
    });
  });
  document.querySelectorAll("[data-gohan-proteina]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.gohanConfig) return;
      state.gohanConfig.proteina = btn.dataset.gohanProteina;
      syncGohanModalUI();
    });
  });
  document.getElementById("btn-gohan-furay")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!state.gohanConfig) return;
    state.gohanConfig.furay = !state.gohanConfig.furay;
    syncGohanModalUI();
  });
  document.querySelectorAll("[data-gohan-veg]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (!state.gohanConfig) return;
      const veg = btn.dataset.gohanVeg;
      const list = [...(state.gohanConfig.vegetales || [])];
      const idx = list.indexOf(veg);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else if (list.length >= 2) {
        showGohanVegError("Solo puedes elegir 2");
        return;
      } else {
        list.push(veg);
      }
      state.gohanConfig.vegetales = list;
      state.gohanConfig.vegError = null;
      syncGohanModalUI();
    });
  });
  document.getElementById("gohan-cant-minus")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!state.gohanConfig) return;
    state.gohanConfig.cantidad = Math.max(1, (state.gohanConfig.cantidad || 1) - 1);
    syncGohanModalUI();
  });
  document.getElementById("gohan-cant-plus")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!state.gohanConfig) return;
    state.gohanConfig.cantidad = (state.gohanConfig.cantidad || 1) + 1;
    syncGohanModalUI();
  });
  document.getElementById("btn-confirmar-gohan")?.addEventListener("click", (e) => {
    e.preventDefault();
    const cfg = state.gohanConfig;
    if (!cfg || !gohanConfigCompleta(cfg)) {
      showToast("Elige espolvoreado, proteína y 2 vegetales", true);
      return;
    }
    const { p, furay, precioFuray, unit } = gohanModalSnapshot(cfg);
    if (!p) {
      showToast("Falta el producto Gohan. Ejecuta seed_menu.", true);
      return;
    }
    if (cfg.furay && !furay) {
      showToast(`Falta el producto «${NOMBRE_FURAY}».`, true);
      return;
    }
    const cant = cfg.cantidad || 1;
    state.cart.push({
      producto: p.id,
      nombre: "Arma tu Gohan",
      categoria: "gohan",
      precio: unit,
      precioBase: Number(p.precio),
      cantidad: cant,
      gohanArmado: labelGohanArmado(cfg),
      furay: Boolean(cfg.furay),
      extrasFuray: cfg.furay ? 1 : 0,
      furayProductoId: furay?.id || null,
      furayPrecio: precioFuray,
    });
    state.gohanConfig = null;
    state.cartOpen = true;
    state.fieldErrors = {};
    render({ preserveScroll: true });
    showToast("Agregado al pedido");
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (state.addModal) {
    state.addModal = null;
    render();
  } else if (state.shawarmaConfig) {
    state.shawarmaConfig = null;
    render();
  } else if (state.rollConfig) {
    state.rollConfig = null;
    render();
  } else if (state.gohanConfig) {
    state.gohanConfig = null;
    render();
  } else if (state.cartOpen) {
    syncFormFromDom();
    state.cartOpen = false;
    render();
  }
});

async function loadCarta() {
  state.loading = true;
  state.error = null;
  render();
  try {
    const [productos, zonas, horario] = await Promise.all([
      publicGet("/api/carta/"),
      publicGet("/api/zonas-delivery/publicas/").catch(() => []),
      publicGet("/api/horario-pedidos/").catch(() => ({
        abierto: true,
        mensaje: "",
        horario: "",
      })),
    ]);
    state.productos = productos;
    state.zonas = Array.isArray(zonas) ? zonas : [];
    state.horario = {
      abierto: horario?.abierto !== false,
      mensaje: horario?.mensaje || "",
      horario: horario?.horario || "",
    };
    state.loading = false;
    if (!CATEGORIAS.some(([id]) => state.productos.some((p) => p.categoria === id))) {
      state.categoria = "todas";
    }
    render();
  } catch (e) {
    state.loading = false;
    state.error = e.message || "No se pudo cargar la carta";
    render();
  }
}

state.resultado = leerResultadoUrl();
if (state.resultado) {
  render();
} else {
  loadCarta();
}
