import "./style.css";
import { escapeHtml } from "./dom.js";
import {
  SALSAS_SHAWARMA,
  PRECIO_SALSA_EXTRA,
  esShawarma,
  extrasSalsaCount,
  labelShawarmaLinea,
  parseIngredientesShawarma,
  precioUnitarioShawarma,
} from "./shawarmas.js";
import { esTabla } from "./tablas.js";

const rawBase = import.meta.env.VITE_API_URL || "";
const API_BASE = String(rawBase).replace(/\/$/, "");
const PRECIO_PALTA_EXTRA = 1000;

/** Extras que no se listan solos: se agregan al personalizar. */
const OCULTOS_CARTA = new Set(["Salsa extra", "Palta extra"]);

const CATEGORIAS = [
  ["ceviches", "Ceviches"],
  ["picoteo", "Para picar"],
  ["papas", "Papas"],
  ["shawarmas", "Shawarmas"],
  ["tablas", "Tablas"],
  ["gohan", "Gohan"],
  ["bebestibles", "Bebestibles"],
  ["agregados", "Extras"],
];

const CAT_LABEL = Object.fromEntries(CATEGORIAS);

/** Acento suave por categoría (solo color de ambiente, no cambia la marca). */
const CAT_TONE = {
  ceviches: "tone-sea",
  picoteo: "tone-sun",
  papas: "tone-gold",
  shawarmas: "tone-spice",
  tablas: "tone-coral",
  gohan: "tone-leaf",
  bebestibles: "tone-sky",
  agregados: "tone-mist",
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
  addModal: null,
  loading: true,
  paying: false,
  error: null,
  toast: null,
  resultado: null,
  firstPaint: true,
};

let toastTimer = null;

function money(n) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
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
  return state.productos.filter((p) => {
    if (OCULTOS_CARTA.has(p.nombre)) return false;
    if (state.categoria !== "todas" && p.categoria !== state.categoria) return false;
    if (!q) return true;
    return (
      p.nombre.toLowerCase().includes(q) ||
      String(p.descripcion || "")
        .toLowerCase()
        .includes(q)
    );
  });
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
    throw new Error(
      (typeof data?.detail === "string" && data.detail) ||
        text ||
        `Error HTTP ${res.status}`
    );
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
    throw new Error(
      (typeof data?.detail === "string" && data.detail) ||
        (data && typeof data === "object" ? JSON.stringify(data) : null) ||
        text ||
        `Error HTTP ${res.status}`
    );
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

function abrirProducto(p) {
  if (esShawarma(p)) {
    const parsed = parseIngredientesShawarma(p);
    state.shawarmaConfig = {
      producto: p,
      ings: parsed.fijos.map((n) => ({ nombre: n, incluido: true })),
      eligeProteina: parsed.eligeProteina,
      proteinaOpciones: parsed.proteinaOpciones,
      proteina: parsed.eligeProteina ? parsed.proteinaOpciones[0] : "",
      salsas: Object.fromEntries(SALSAS_SHAWARMA.map((s) => [s, false])),
      cantidad: 1,
    };
    state.addModal = null;
  } else {
    state.addModal = { producto: p, cantidad: 1, nota: "", conPalta: false };
    state.shawarmaConfig = null;
  }
  render({ preserveScroll: true });
}

function syncAddModalUI() {
  const m = state.addModal;
  if (!m) return;
  const unit = Number(m.producto.precio) + (m.conPalta ? PRECIO_PALTA_EXTRA : 0);
  const cant = m.cantidad || 1;
  const precioEl = document.querySelector("#add-overlay .pedir-modal-price");
  if (precioEl) precioEl.textContent = money(unit);
  const cantEl = document.getElementById("add-cant-val");
  if (cantEl) cantEl.textContent = String(cant);
  const btn = document.getElementById("btn-confirmar-add");
  if (btn) btn.textContent = `Agregar · ${money(unit * cant)}`;
  const cb = document.getElementById("add-palta");
  if (cb && cb.checked !== Boolean(m.conPalta)) cb.checked = Boolean(m.conPalta);
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
    precioEl.textContent = `${money(unit)} · total ${money(unit * cant)}`;
  }
  const cantEl = document.getElementById("shawarma-cant-val");
  if (cantEl) cantEl.textContent = String(cant);
  const btn = document.getElementById("btn-confirmar-shawarma");
  if (btn) btn.textContent = `Agregar · ${money(unit * cant)}`;
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
  return `
    <article class="pedir-item ${tone}" data-add="${p.id}">
      <div class="pedir-item-swatch" aria-hidden="true"></div>
      <div class="pedir-item-body">
        <h3>${escapeHtml(p.nombre)}</h3>
        ${p.descripcion ? `<p>${escapeHtml(p.descripcion)}</p>` : ""}
        <div class="pedir-item-price">${money(p.precio)}</div>
      </div>
      <button type="button" class="pedir-item-add" data-add="${p.id}" aria-label="Agregar ${escapeHtml(p.nombre)}">
        <span aria-hidden="true">+</span>
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
              <button type="button" class="pedir-btn-primary" id="btn-pagar" ${state.paying ? "disabled" : ""}>
                ${state.paying ? "Abriendo Webpay…" : `Pagar con Webpay · ${money(cartTotal())}`}
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
  const unit = Number(p.precio) + (m.conPalta ? PRECIO_PALTA_EXTRA : 0);
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
              ? `<p class="pedir-modal-note">Puedes dejar una nota; el local confirma cambios de rolls.</p>`
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
            <p class="pedir-modal-price">${money(unit)} · total ${money(unit * cant)}</p>
          </div>
          <button type="button" class="pedir-icon-btn" id="btn-cerrar-shawarma" aria-label="Cerrar">×</button>
        </header>
        <div class="pedir-modal-body">
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
        <p class="pedir-hero-lead">¿Qué se te antoja hoy? Arma tu pedido con calma y paga seguro con Webpay.</p>
      </div>

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

  document.querySelectorAll(".pedir-item").forEach((row) => {
    row.addEventListener("click", (e) => {
      e.preventDefault();
      const id = row.dataset.add;
      const p = state.productos.find((x) => String(x.id) === String(id));
      if (p) abrirProducto(p);
    });
  });
  document.querySelectorAll(".pedir-item-add").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.add;
      const p = state.productos.find((x) => String(x.id) === String(id));
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
  document.getElementById("btn-confirmar-add")?.addEventListener("click", (e) => {
    e.preventDefault();
    const m = state.addModal;
    if (!m) return;
    const nota = document.getElementById("add-nota")?.value || "";
    const conPalta =
      m.producto.categoria === "ceviches" &&
      Boolean(document.getElementById("add-palta")?.checked);
    const precio = Number(m.producto.precio) + (conPalta ? PRECIO_PALTA_EXTRA : 0);
    state.cart.push({
      producto: m.producto.id,
      nombre: m.producto.nombre + (conPalta ? " + palta" : ""),
      categoria: m.producto.categoria,
      precio,
      precioBase: Number(m.producto.precio),
      cantidad: m.cantidad,
      nota,
      extrasPalta: conPalta ? 1 : 0,
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
      }),
      salsas,
      extrasSalsa: extras,
    });
    state.shawarmaConfig = null;
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
    const [productos, zonas] = await Promise.all([
      publicGet("/api/carta/"),
      publicGet("/api/zonas-delivery/publicas/").catch(() => []),
    ]);
    state.productos = productos;
    state.zonas = Array.isArray(zonas) ? zonas : [];
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
