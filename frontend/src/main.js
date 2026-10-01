import "./style.css";
import {
  api,
  clearSession,
  getCachedUser,
  getTokens,
  login,
  setCachedUser,
} from "./api.js";
import { countPendingSales, savePendingSale } from "./db.js";
import { escapeHtml } from "./dom.js";
import { syncPendingSales, watchConnectivity } from "./sync.js";
import { esTabla, labelRoll, rollsDeTabla } from "./tablas.js";
import {
  SALSAS_SHAWARMA,
  PRECIO_SALSA_EXTRA,
  esShawarma,
  extrasSalsaCount,
  labelShawarmaLinea,
  parseIngredientesShawarma,
  precioUnitarioShawarma,
} from "./shawarmas.js";
import {
  cerrarVentanasImpresion,
  imprimirComandaCocina,
  imprimirTicketCliente,
  imprimirTicketYCocina,
  normalizarVentaParaTicket,
  prepararVentanasImpresion,
} from "./ticket.js";

const app = document.getElementById("app");

const state = {
  user: getCachedUser(),
  online: navigator.onLine,
  pending: 0,
  view: "pos",
  productos: [],
  categoria: "todas",
  cart: [],
  cartOpen: false,
  /** Configurador de tabla: { producto, rolls, nota } */
  tablaConfig: null,
  /** Configurador shawarma: { producto, ings, eligeProteina, proteina, salsas, cantidad } */
  shawarmaConfig: null,
  /** Modal agregar ítem simple: { producto, cantidad, nota } */
  addModal: null,
  metodo_pago: "efectivo",
  tipo_entrega: "retiro",
  cobro_delivery: 0,
  /** Dirección obligatoria si la entrega es delivery. */
  direccion_delivery: "",
  /** Nota general del pedido (cliente / cocina). */
  nota_pedido: "",
  ventas: [],
  /** Venta seleccionada en historial para ver detalle */
  ventaDetalle: null,
  /** Tras cobrar: muestra acciones de ticket/comanda */
  postCobro: null,
  /** Pedidos web pagados pendientes de recepción */
  pedidos: [],
  pedidosKnownIds: new Set(),
  pedidosPollTimer: null,
  inventario: [],
  cajaPreview: null,
  reporteFecha: fechaLocalHoy(),
  reporte: null,
  /** Confirmación salsa extra: { salsa } */
  confirmSalsa: null,
  toast: null,
};

/** Fecha YYYY-MM-DD en zona del local (Punta Arenas). */
function fechaLocalHoy() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Punta_Arenas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const CATEGORIAS = [
  ["todas", "Todas"],
  ["ceviches", "Ceviches"],
  ["picoteo", "Para picar"],
  ["papas", "Papas"],
  ["shawarmas", "Shawarmas"],
  ["tablas", "Tablas"],
  ["gohan", "Gohan"],
  ["bebestibles", "Bebestibles"],
  ["agregados", "Agregados"],
];

function brandLockup(compact = false) {
  if (compact) {
    return `
      <div class="topbar-brand">
        <span class="brush">el Tenedor</span>
        <span class="script">General del Canto</span>
      </div>
    `;
  }
  return `
    <div class="brand-lockup">
      <h1 class="brand-brush">el Tenedor</h1>
      <p class="brand-script">General del Canto</p>
      <hr class="brand-rule" />
      <p class="brand-tag">Restaurante para llevar</p>
    </div>
  `;
}

function money(n) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function toast(msg, isError = false) {
  state.toast = { msg, isError };
  render();
  setTimeout(() => {
    state.toast = null;
    render();
  }, 3200);
}

function cartTotal() {
  const sub = state.cart.reduce((a, l) => a + Number(l.precio) * Number(l.cantidad), 0);
  const delivery =
    state.tipo_entrega === "delivery" ? Number(state.cobro_delivery) || 0 : 0;
  return sub + delivery;
}

function idSalsaExtra() {
  return state.productos.find((p) => p.nombre === "Salsa extra")?.id || null;
}

function idPaltaExtra() {
  return state.productos.find((p) => p.nombre === "Palta extra")?.id || null;
}

const PRECIO_PALTA_EXTRA = 1000;

async function refreshPending() {
  state.pending = await countPendingSales(state.user?.id);
}

async function trySync(showToast = true) {
  if (!state.online) return;
  try {
    const result = await syncPendingSales();
    await refreshPending();
    if (showToast && result && !result.skipped) {
      const n = result.creadas?.length || 0;
      const rechazadas = result.rechazadas || [];
      if (n || result.omitidas_idempotentes?.length) {
        toast(result.mensaje || `Sincronizadas ${n} venta(s).`);
      }
      if (rechazadas.length) {
        const motivo =
          rechazadas[0].motivo || rechazadas[0].detail || "rechazada";
        toast(
          rechazadas.length === 1
            ? `Venta pendiente rechazada: ${motivo}`
            : `${rechazadas.length} ventas pendientes rechazadas (no se reintentan)`,
          true
        );
      }
    }
    render();
  } catch (e) {
    if (showToast) toast(e.message || "Error al sincronizar", true);
  }
}

async function bootstrap() {
  watchConnectivity(async (online) => {
    state.online = online;
    render();
    if (online && getTokens()) await trySync(true);
  });

  if (getTokens() && state.user) {
    try {
      state.user = await api.me();
      setCachedUser(state.user);
      await loadProductos();
      await refreshPending();
      await trySync(false);
      startPedidosPolling();
    } catch {
      clearSession();
      state.user = null;
    }
  }
  render();
}

async function loadProductos() {
  state.productos = await api.productos();
}

function renderLogin() {
  app.innerHTML = `
    <section class="login-screen">
      <form class="login-panel" id="login-form">
        ${brandLockup(false)}
        <p class="hint">POS interno · funciona sin internet</p>
        <div class="field">
          <label for="username">Usuario</label>
          <input id="username" name="username" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="password">Contraseña</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn btn-primary" type="submit">Entrar</button>
        <p class="error" id="login-error" hidden></p>
      </form>
    </section>
  `;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("login-error");
    err.hidden = true;
    const fd = new FormData(e.target);
    try {
      state.user = await login(fd.get("username"), fd.get("password"));
      await loadProductos();
      await refreshPending();
      await trySync(false);
      startPedidosPolling();
      state.view = "pos";
      render();
    } catch (ex) {
      err.textContent = ex.message || "No se pudo iniciar sesión";
      err.hidden = false;
    }
  });
}

function shell(content) {
  const isAdmin = state.user?.rol === "administrador";
  return `
    <div class="shell">
      <header class="topbar">
        ${brandLockup(true)}
        <div class="topbar-meta">
          <span class="pill ${state.online ? "online" : "offline"}">
            ${state.online ? "En línea" : "Sin conexión"}
          </span>
          <span class="pill">Cola: ${state.pending}</span>
          <span class="pill">${escapeHtml(state.user?.username)} · ${escapeHtml(state.user?.rol)}</span>
          <button class="btn btn-mint" id="btn-sync" type="button" ${state.online ? "" : "disabled"}>Sincronizar</button>
          <button class="btn btn-ghost" id="btn-logout" type="button">Salir</button>
        </div>
      </header>
      <nav class="nav">
        <button data-view="pos" class="${state.view === "pos" ? "active" : ""}">Ventas</button>
        <button data-view="pedidos" class="${state.view === "pedidos" ? "active" : ""}">
          Pedidos${
            state.pedidos.length
              ? `<span class="nav-badge">${state.pedidos.length}</span>`
              : ""
          }
        </button>
        <button data-view="ventas" class="${state.view === "ventas" ? "active" : ""}">Historial</button>
        ${
          isAdmin
            ? `
          <button data-view="inventario" class="${state.view === "inventario" ? "active" : ""}">Inventario</button>
          <button data-view="caja" class="${state.view === "caja" ? "active" : ""}">Caja</button>
          <button data-view="reportes" class="${state.view === "reportes" ? "active" : ""}">Reportes</button>
        `
            : ""
        }
      </nav>
      <main class="main">${content}</main>
      ${
        state.toast
          ? `<div class="toast ${state.toast.isError ? "error" : ""}">${escapeHtml(state.toast.msg)}</div>`
          : ""
      }
    </div>
  `;
}

function cartItemsCount() {
  return state.cart.reduce((a, l) => a + l.cantidad, 0);
}

function renderCartLines() {
  if (!state.cart.length) {
    return `<div class="cart-empty">Aún no hay productos. Toca la carta para agregarlos.</div>`;
  }
  return `
    <div class="cart-detail">
      <p class="cart-detail-title">Detalle del pedido · ${cartItemsCount()} producto(s)</p>
      ${state.cart
        .map(
          (l, i) => `
      <article class="cart-line">
        <div class="cart-line-main">
          <div class="cart-line-cat">${escapeHtml(l.categoria || "")}</div>
          <strong>${escapeHtml(l.nombre)}</strong>
          ${
            l.descripcion && !l.rolls?.length && !l.nota
              ? `<p class="cart-line-desc">${escapeHtml(l.descripcion)}</p>`
              : ""
          }
          ${
            l.nota
              ? `<p class="cart-line-desc"><em>Nota:</em> ${escapeHtml(l.nota)}</p>`
              : ""
          }
          ${
            l.shawarma
              ? `<p class="cart-line-desc">${escapeHtml(l.shawarma)}</p>`
              : ""
          }
          ${
            l.rolls?.length
              ? `<ul class="cart-rolls">
                  ${l.rolls
                    .map((r) => {
                      const sin = r.quitados?.length
                        ? ` <em class="sin-ing">sin ${escapeHtml(r.quitados.join(", "))}</em>`
                        : "";
                      return `<li class="roll-pill">${escapeHtml(r.label)}${sin}</li>`;
                    })
                    .join("")}
                </ul>`
              : ""
          }
          ${
            l.rolls_quitados?.length
              ? `<p class="cart-line-desc quitados">Sin: ${escapeHtml(l.rolls_quitados.join(" · "))}</p>`
              : ""
          }
          <div class="cart-line-meta">${money(l.precio)} c/u</div>
          <div class="qty">
            <button type="button" data-dec="${i}" aria-label="Menos">−</button>
            <span>${l.cantidad}</span>
            <button type="button" data-inc="${i}" aria-label="Más">+</button>
          </div>
        </div>
        <div class="cart-line-side">
          <span class="price-tag">${money(l.precio * l.cantidad)}</span>
          <button type="button" data-del="${i}" class="btn btn-ghost btn-tiny">Quitar</button>
        </div>
      </article>
    `
        )
        .join("")}
    </div>
  `;
}

function renderCartCheckoutFields() {
  return `
    <div class="cart-checkout">
      <p class="cart-checkout-title">Cobro</p>
      <div class="cart-checkout-row">
        <div class="field">
          <label>Método de pago</label>
          <select id="metodo_pago">
            <option value="efectivo" ${state.metodo_pago === "efectivo" ? "selected" : ""}>Efectivo</option>
            <option value="tarjeta" ${state.metodo_pago === "tarjeta" ? "selected" : ""}>Tarjeta</option>
            <option value="transferencia" ${state.metodo_pago === "transferencia" ? "selected" : ""}>Transferencia</option>
          </select>
        </div>
        <div class="field">
          <label>Entrega</label>
          <select id="tipo_entrega">
            <option value="retiro" ${state.tipo_entrega === "retiro" ? "selected" : ""}>Retiro</option>
            <option value="delivery" ${state.tipo_entrega === "delivery" ? "selected" : ""}>Delivery</option>
          </select>
        </div>
        <div class="field ${state.tipo_entrega === "delivery" ? "" : "is-disabled"}">
          <label>Cobro delivery</label>
          <input id="cobro_delivery" type="number" min="0" step="100" value="${state.cobro_delivery}" ${state.tipo_entrega === "delivery" ? "" : "disabled"} />
        </div>
      </div>
      ${
        state.tipo_entrega === "delivery"
          ? `
      <div class="field">
        <label for="direccion_delivery">Dirección <span class="req">*</span></label>
        <input id="direccion_delivery" type="text" required autocomplete="street-address" placeholder="Calle, número, depto / referencia" value="${escapeHtml(state.direccion_delivery)}" />
      </div>`
          : ""
      }
      <div class="field">
        <label for="nota_pedido">Nota del pedido</label>
        <textarea id="nota_pedido" rows="2" placeholder="Ej. sin cubiertos, tocar timbre, alergia…">${escapeHtml(state.nota_pedido)}</textarea>
      </div>
      <div class="cart-total"><span>Total</span><span class="price-tag">${money(cartTotal())}</span></div>
      ${
        !state.cart.length
          ? `<p class="cart-error" role="alert">Agrega al menos un producto para enviar el pedido.</p>`
          : ""
      }
      <div class="cart-actions">
        <button class="btn btn-primary" id="btn-cobrar" type="button">
          ${state.online ? "Cobrar y enviar" : "Cobrar offline"}
        </button>
        <button class="btn btn-ghost" id="btn-limpiar" type="button">Vaciar pedido</button>
      </div>
    </div>
  `;
}

function renderConfirmSalsa() {
  const c = state.confirmSalsa;
  if (!c) return "";
  return confirmSalsaHtml(c);
}

function confirmSalsaHtml(c) {
  return `
    <div class="pedido-overlay" id="confirm-salsa-overlay" role="dialog" aria-modal="true">
      <div class="pedido-modal add-modal">
        <div class="pedido-modal-body add-modal-body" style="padding-top:18px">
          <p class="confirm-msg">
            Ya tienes 1 salsa incluida.<br />
            <strong>${escapeHtml(c.salsa)}</strong> extra cuesta <strong>${money(PRECIO_SALSA_EXTRA)}</strong>.
          </p>
          <p class="tabla-hint" style="margin:8px 0 14px">¿La agregás?</p>
          <div class="add-qty-row">
            <button type="button" class="btn btn-ghost" id="btn-salsa-no" style="width:auto;flex:1">No</button>
            <button type="button" class="btn btn-add" id="btn-salsa-si" style="width:auto;flex:1">Sí</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function syncIngToggleEl(btn, incluido, nombre) {
  const wrap = btn.closest(".ing-plain");
  if (wrap) wrap.classList.toggle("is-off", !incluido);
  btn.classList.toggle("is-remove", incluido);
  btn.classList.toggle("is-add", !incluido);
  btn.textContent = incluido ? "×" : "+";
  if (nombre) {
    btn.setAttribute("aria-label", incluido ? `Quitar ${nombre}` : `Agregar ${nombre}`);
  }
}

function syncChoiceBox(btn, on) {
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-checked", on ? "true" : "false");
  const box = btn.querySelector(".opt-box");
  if (box) box.textContent = on ? "✓" : "";
}

function syncShawarmaPrecio() {
  const cfg = state.shawarmaConfig;
  if (!cfg) return;
  const salsasSel = SALSAS_SHAWARMA.filter((s) => cfg.salsas[s]);
  const extras = extrasSalsaCount(salsasSel);
  const unit = precioUnitarioShawarma(cfg.producto.precio, salsasSel);
  const cant = cfg.cantidad || 1;
  const el = document.getElementById("shawarma-precio");
  if (el) {
    el.textContent = `${money(unit)} c/u${extras ? ` · incluye ${extras} salsa(s) extra` : ""} · total ${money(unit * cant)}`;
  }
  const input = document.getElementById("shawarma-cantidad");
  if (input && Number(input.value) !== cant) input.value = String(cant);
}

function syncProteinaUI() {
  const cfg = state.shawarmaConfig;
  if (!cfg) return;
  document.querySelectorAll("[data-proteina]").forEach((btn) => {
    syncChoiceBox(btn, cfg.proteina === btn.dataset.proteina);
  });
}

function syncSalsaUI() {
  const cfg = state.shawarmaConfig;
  if (!cfg) return;
  document.querySelectorAll("[data-salsa-btn]").forEach((btn) => {
    syncChoiceBox(btn, Boolean(cfg.salsas[btn.dataset.salsaBtn]));
  });
  syncShawarmaPrecio();
}

function syncShawarmaIngsUI() {
  const cfg = state.shawarmaConfig;
  if (!cfg) return;
  document.querySelectorAll("[data-toggle-shawarma-ing]").forEach((btn) => {
    const iIdx = Number(btn.dataset.toggleShawarmaIng);
    const ing = cfg.ings[iIdx];
    if (!ing) return;
    syncIngToggleEl(btn, ing.incluido, ing.nombre);
  });
}

function syncTablaIngsUI() {
  const cfg = state.tablaConfig;
  if (!cfg) return;
  document.querySelectorAll("[data-toggle-ing]").forEach((btn) => {
    const [rIdx, iIdx] = btn.dataset.toggleIng.split(":").map(Number);
    const ing = cfg.rolls?.[rIdx]?.ingredientes?.[iIdx];
    if (!ing) return;
    syncIngToggleEl(btn, ing.incluido, ing.nombre);
  });
}

function cerrarTablaModal() {
  state.tablaConfig = null;
  render();
}

function resetShawarmaConfigDefaults(cfg) {
  if (!cfg) return;
  cfg.ings.forEach((ing) => {
    ing.incluido = true;
  });
  cfg.proteina = null;
  cfg.salsas = Object.fromEntries(SALSAS_SHAWARMA.map((s) => [s, false]));
  cfg.salsas.Ajo = true;
  cfg.cantidad = 1;
}

function hideConfirmSalsa() {
  state.confirmSalsa = null;
  document.getElementById("confirm-salsa-overlay")?.remove();
}

function cerrarShawarmaModal() {
  hideConfirmSalsa();
  state.shawarmaConfig = null;
  render();
}

function showConfirmSalsa(salsa) {
  state.confirmSalsa = { salsa };
  document.getElementById("confirm-salsa-overlay")?.remove();
  const wrap = document.createElement("div");
  wrap.innerHTML = confirmSalsaHtml(state.confirmSalsa);
  const overlay = wrap.firstElementChild;
  document.getElementById("app")?.appendChild(overlay);
  document.getElementById("btn-salsa-si")?.addEventListener("click", () => {
    if (!state.shawarmaConfig || !state.confirmSalsa) return;
    state.shawarmaConfig.salsas[state.confirmSalsa.salsa] = true;
    hideConfirmSalsa();
    syncSalsaUI();
  });
  document.getElementById("btn-salsa-no")?.addEventListener("click", () => {
    hideConfirmSalsa();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target.id === "confirm-salsa-overlay") hideConfirmSalsa();
  });
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
    <div class="pedido-overlay" id="shawarma-overlay" role="dialog" aria-modal="true">
      <div class="pedido-modal tabla-modal">
        <header class="pedido-modal-head">
          <div>
            <p class="pedido-kicker">Personalizar shawarma</p>
            <h2>${escapeHtml(p.nombre)}</h2>
            <p class="tabla-precio" id="shawarma-precio">${money(unit)} c/u${extras ? ` · incluye ${extras} salsa(s) extra` : ""} · total ${money(unit * cant)}</p>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-shawarma" aria-label="Cerrar">×</button>
        </header>
        <div class="pedido-modal-body">
          ${
            cfg.eligeProteina
              ? `
            <div class="opt-block">
              <p class="tabla-hint"><strong>Proteína</strong> (elige una)</p>
              <div class="opt-row-plain">
                ${cfg.proteinaOpciones
                  .map(
                    (op, i) => `
                  ${i ? `<span class="opt-sep" aria-hidden="true">·</span>` : ""}
                  <button type="button" class="opt-plain opt-choice ${cfg.proteina === op ? "is-on" : ""}" data-proteina="${escapeHtml(op)}" role="checkbox" aria-checked="${cfg.proteina === op ? "true" : "false"}">
                    <span class="opt-box" aria-hidden="true">${cfg.proteina === op ? "✓" : ""}</span>
                    ${escapeHtml(op)}
                  </button>`
                  )
                  .join("")}
              </div>
            </div>`
              : ""
          }
          <div class="opt-block">
            <p class="tabla-hint">Ingredientes</p>
            <div class="opt-row-plain">
              ${cfg.ings
                .map(
                  (ing, iIdx) => `
                ${iIdx ? `<span class="opt-sep" aria-hidden="true">·</span>` : ""}
                <span class="ing-plain ${ing.incluido ? "" : "is-off"}">
                  <span class="ing-name">${escapeHtml(ing.nombre)}</span>
                  <button type="button" class="ing-toggle ${ing.incluido ? "is-remove" : "is-add"}" data-toggle-shawarma-ing="${iIdx}" aria-label="${ing.incluido ? `Quitar ${escapeHtml(ing.nombre)}` : `Agregar ${escapeHtml(ing.nombre)}`}">${ing.incluido ? "×" : "+"}</button>
                </span>`
                )
                .join("")}
            </div>
          </div>
          <div class="opt-block">
            <p class="tabla-hint">
              <strong>Salsas</strong> · 1 incluida · extras ${money(PRECIO_SALSA_EXTRA)} c/u
            </p>
            <div class="opt-row-plain">
              ${SALSAS_SHAWARMA.map(
                (s, i) => `
                ${i ? `<span class="opt-sep" aria-hidden="true">·</span>` : ""}
                <button type="button" class="opt-plain opt-choice ${cfg.salsas[s] ? "is-on" : ""}" data-salsa-btn="${escapeHtml(s)}" role="checkbox" aria-checked="${cfg.salsas[s] ? "true" : "false"}">
                  <span class="opt-box" aria-hidden="true">${cfg.salsas[s] ? "✓" : ""}</span>
                  ${escapeHtml(s)}
                </button>`
              ).join("")}
            </div>
          </div>
          <div class="field add-qty-field" style="margin-top:14px">
            <label class="add-qty-label" for="shawarma-cantidad">Cantidad</label>
            <div class="add-qty">
              <button type="button" id="btn-shawarma-dec" aria-label="Menos">−</button>
              <input id="shawarma-cantidad" type="number" min="1" step="1" value="${cant}" />
              <button type="button" id="btn-shawarma-inc" aria-label="Más">+</button>
            </div>
          </div>
        </div>
        <footer class="pedido-modal-foot">
          <button type="button" class="btn btn-ghost" id="btn-shawarma-reset">Restablecer</button>
          <button type="button" class="btn btn-add" id="btn-shawarma-confirmar">Agregar</button>
        </footer>
      </div>
    </div>
  `;
}

function renderTablaRollLine(roll, rIdx, { showEnv = true } = {}) {
  return `
    <div class="tabla-roll-line">
      ${showEnv ? `<span class="tabla-roll-env">${escapeHtml(roll.env)}</span>` : ""}
      <div class="opt-row-plain">
        ${roll.ingredientes
          .map(
            (ing, iIdx) => `
          ${iIdx ? `<span class="opt-sep" aria-hidden="true">·</span>` : ""}
          <span class="ing-plain ${ing.incluido ? "" : "is-off"}">
            <span class="ing-name">${escapeHtml(ing.nombre)}</span>
            <button type="button" class="ing-toggle ${ing.incluido ? "is-remove" : "is-add"}" data-toggle-ing="${rIdx}:${iIdx}" aria-label="${ing.incluido ? `Quitar ${escapeHtml(ing.nombre)}` : `Agregar ${escapeHtml(ing.nombre)}`}">${ing.incluido ? "×" : "+"}</button>
          </span>`
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderTablaRollsList(rolls) {
  return rolls
    .map(
      (roll, rIdx) => `
        <li class="tabla-roll-card">
          ${renderTablaRollLine(roll, rIdx, { showEnv: true })}
        </li>
      `
    )
    .join("");
}

function renderTablaModal() {
  const cfg = state.tablaConfig;
  if (!cfg) return "";
  const p = cfg.producto;

  return `
    <div class="pedido-overlay" id="tabla-overlay" role="dialog" aria-modal="true">
      <div class="pedido-modal tabla-modal">
        <header class="pedido-modal-head">
          <div>
            <p class="pedido-kicker">Personalizar tabla</p>
            <h2>${escapeHtml(p.nombre)}</h2>
            <p class="tabla-precio">${money(p.precio)}</p>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-tabla" aria-label="Cerrar">×</button>
        </header>
        <div class="pedido-modal-body">
          <p class="tabla-hint">Ingredientes · toca <span class="hint-x">×</span> o <span class="hint-plus">+</span></p>
          <ul class="tabla-rolls-list">
            ${renderTablaRollsList(cfg.rolls)}
          </ul>
        </div>
        <footer class="pedido-modal-foot">
          <button type="button" class="btn btn-ghost" id="btn-tabla-todos">Restablecer ingredientes</button>
          <button type="button" class="btn btn-add" id="btn-tabla-confirmar">
            Agregar
          </button>
        </footer>
      </div>
    </div>
  `;
}

function renderPedidoModal() {
  if (!state.cartOpen) return "";
  return `
    <div class="pedido-overlay" id="pedido-overlay" role="dialog" aria-modal="true" aria-labelledby="pedido-title">
      <div class="pedido-modal">
        <header class="pedido-modal-head">
          <div>
            <p class="pedido-kicker">${cartItemsCount()} ítem(s)</p>
            <h2 id="pedido-title">Pedido actual</h2>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-pedido" aria-label="Cerrar">×</button>
        </header>
        <div class="pedido-modal-body">
          ${renderCartLines()}
        </div>
        <footer class="pedido-modal-foot">
          ${renderCartCheckoutFields()}
        </footer>
      </div>
    </div>
  `;
}

function renderAddModal() {
  const cfg = state.addModal;
  if (!cfg) return "";
  const p = cfg.producto;
  const esCeviche = p.categoria === "ceviches";
  const conPalta = Boolean(cfg.conPalta);
  const unit = Number(p.precio) + (esCeviche && conPalta ? PRECIO_PALTA_EXTRA : 0);
  return `
    <div class="pedido-overlay" id="add-overlay" role="dialog" aria-modal="true">
      <div class="pedido-modal add-modal">
        <header class="pedido-modal-head add-modal-head">
          <div class="add-modal-title">
            <span class="add-modal-name">${escapeHtml(p.nombre)}</span>
            <span class="add-modal-price">${money(unit)}</span>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-add" aria-label="Cerrar">×</button>
        </header>
        <div class="pedido-modal-body add-modal-body">
          ${
            esCeviche
              ? `<label class="opt-plain ${conPalta ? "is-on" : ""}" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:12px;cursor:pointer">
                  <input type="checkbox" id="add-palta" ${conPalta ? "checked" : ""} style="accent-color:var(--ok)" />
                  Palta extra · ${money(PRECIO_PALTA_EXTRA)}
                </label>`
              : ""
          }
          <label class="add-qty-label" for="add-cantidad">Cantidad</label>
          <div class="add-qty-row">
            <div class="add-qty">
              <button type="button" id="btn-add-dec" aria-label="Menos">−</button>
              <input id="add-cantidad" type="number" min="1" step="1" value="${cfg.cantidad || 1}" />
              <button type="button" id="btn-add-inc" aria-label="Más">+</button>
            </div>
            <button type="button" class="btn btn-add" id="btn-add-confirmar">Agregar</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPos() {
  const activos = state.productos.filter((p) => p.estado === "activo");
  const filtered =
    state.categoria === "todas"
      ? activos
      : activos.filter((p) => p.categoria === state.categoria);

  return `
    <div class="pos-layout">
      <section>
        <h2 class="section-title">Nuestra carta</h2>
        <div class="filters">
          ${CATEGORIAS.map(
            ([id, label]) =>
              `<button type="button" data-cat="${id}" class="${state.categoria === id ? "active" : ""}">${label}</button>`
          ).join("")}
        </div>
        <div class="product-grid">
          ${filtered
            .map(
              (p) => `
            <article class="product">
              <div>
                <div class="cat">${escapeHtml(p.categoria)}</div>
                <h3>${escapeHtml(p.nombre)}</h3>
                ${p.descripcion ? `<p class="desc">${escapeHtml(p.descripcion)}</p>` : ""}
              </div>
              <div class="product-foot">
                <span class="price-tag">${money(p.precio)}</span>
                <button type="button" class="btn-cart-add" data-add="${p.id}" aria-label="Agregar al pedido" title="Agregar al pedido">
                  <svg class="icon-cart" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none"/>
                    <circle cx="18" cy="20" r="1.4" fill="currentColor" stroke="none"/>
                    <path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.2L20 8H7"/>
                  </svg>
                  <span class="cart-plus" aria-hidden="true">+</span>
                </button>
              </div>
            </article>
          `
            )
            .join("")}
        </div>
      </section>
      <aside class="cart cart-side">
        <div class="cart-side-head">
          <h2>Pedido actual</h2>
          <button type="button" class="btn btn-ghost btn-tiny" id="btn-ampliar-pedido">Ampliar</button>
        </div>
        <div class="cart-side-scroll">
          ${renderCartLines()}
        </div>
        ${state.cartOpen ? "" : renderCartCheckoutFields()}
      </aside>
    </div>
    <button type="button" class="pedido-fab" id="btn-abrir-pedido">
      <span>Ver pedido (${cartItemsCount()})</span>
      <span class="price-tag">${money(cartTotal())}</span>
    </button>
    ${renderPedidoModal()}
    ${renderTablaModal()}
    ${renderShawarmaModal()}
    ${renderAddModal()}
    ${renderPostCobroModal()}
    ${renderConfirmSalsa()}
  `;
}

function renderPostCobroModal() {
  const pc = state.postCobro;
  if (!pc) return "";
  return `
    <div class="pedido-overlay" id="postcobro-overlay" role="dialog" aria-modal="true">
      <div class="pedido-modal" style="max-width:420px">
        <header class="pedido-modal-head">
          <div>
            <p class="pedido-kicker">Pedido listo</p>
            <h2>Impresión enviada</h2>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-postcobro" aria-label="Cerrar">×</button>
        </header>
        <div class="pedido-modal-body">
          <p class="sub" style="margin:0">Pedido #${escapeHtml(pc.id)} · ${money(pc.total)}</p>
          <p class="muted" style="margin-top:8px">Se abrieron ticket (cliente) y comanda (cocina). Si no salió, usa los botones para reimprimir.</p>
        </div>
        <footer class="pedido-modal-foot row-actions" style="margin:0">
          <button type="button" class="btn btn-primary" id="btn-print-ticket" style="width:auto">Reimprimir ticket</button>
          <button type="button" class="btn btn-mint" id="btn-print-cocina" style="width:auto">Reimprimir cocina</button>
        </footer>
      </div>
    </div>
  `;
}

function renderVentaDetalleModal() {
  const v = state.ventaDetalle;
  if (!v) return "";
  const dets = (v.detalles || [])
    .map(
      (d) => `
      <tr>
        <td>${escapeHtml(d.cantidad)}× ${escapeHtml(d.producto_nombre || d.nombre || "")}</td>
        <td>${money(d.subtotal)}</td>
      </tr>
      ${
        d.notas
          ? `<tr><td colspan="2" class="muted" style="padding-top:0">${escapeHtml(d.notas)}</td></tr>`
          : ""
      }`
    )
    .join("");

  const canAnular =
    state.user?.rol === "administrador" && v.estado === "completada";

  return `
    <div class="pedido-overlay" id="detalle-overlay" role="dialog" aria-modal="true">
      <div class="pedido-modal">
        <header class="pedido-modal-head">
          <div>
            <p class="pedido-kicker">Venta #${escapeHtml(v.id)}</p>
            <h2>Detalle del pedido</h2>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-detalle" aria-label="Cerrar">×</button>
        </header>
        <div class="pedido-modal-body">
          <p class="sub" style="margin-top:0">
            ${escapeHtml(new Date(v.fecha_hora).toLocaleString("es-CL"))}<br />
            ${escapeHtml(v.metodo_pago)} · ${escapeHtml(v.tipo_entrega)} · ${escapeHtml(v.estado)}
            ${v.cajero?.username ? `<br />Cajero: ${escapeHtml(v.cajero.username)}` : ""}
            ${v.notas ? `<br /><strong>Nota:</strong> ${escapeHtml(v.notas)}` : ""}
          </p>
          <table class="table">
            <thead><tr><th>Ítem</th><th>Subtotal</th></tr></thead>
            <tbody>${dets || `<tr><td colspan="2" class="muted">Sin detalle</td></tr>`}</tbody>
          </table>
          ${
            Number(v.cobro_delivery) > 0
              ? `<p class="sub">Delivery: ${money(v.cobro_delivery)}</p>`
              : ""
          }
          <p class="cart-total" style="margin-top:12px"><span>Total</span><span class="price-tag">${money(v.total)}</span></p>
        </div>
        <footer class="pedido-modal-foot row-actions" style="margin:0">
          <button type="button" class="btn btn-primary" id="btn-detalle-ticket" style="width:auto">Ticket</button>
          <button type="button" class="btn btn-mint" id="btn-detalle-cocina" style="width:auto">Cocina</button>
          ${
            canAnular
              ? `<button type="button" class="btn btn-danger" id="btn-detalle-anular" style="width:auto">Anular</button>`
              : ""
          }
        </footer>
      </div>
    </div>
  `;
}

function renderVentas() {
  const rows = state.ventas
    .map(
      (v) => `
      <tr>
        <td>#${v.id}</td>
        <td>${escapeHtml(new Date(v.fecha_hora).toLocaleString("es-CL"))}</td>
        <td>${money(v.total)}</td>
        <td>${escapeHtml(v.metodo_pago)}</td>
        <td>${escapeHtml(v.estado)}</td>
        <td>
          <button class="btn btn-ghost btn-tiny" data-detalle="${v.id}" type="button">Ver</button>
        </td>
      </tr>
    `
    )
    .join("");

  return `
    <section class="panel">
      <h2>Historial de ventas</h2>
      <p class="sub">${state.user?.rol === "administrador" ? "Todas las ventas del local." : "Tus ventas del turno."}</p>
      <div class="row-actions">
        <button class="btn btn-mint" id="btn-reload-ventas" type="button">Actualizar</button>
      </div>
      <div style="overflow:auto;margin-top:12px">
        <table class="table">
          <thead><tr><th>ID</th><th>Fecha</th><th>Total</th><th>Pago</th><th>Estado</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="muted">Sin ventas aún.</td></tr>`}</tbody>
        </table>
      </div>
      ${renderVentaDetalleModal()}
    </section>
  `;
}

function renderPedidos() {
  const cards = state.pedidos
    .map((p) => {
      const items = (p.detalles || [])
        .map(
          (d) =>
            `<li><strong>${d.cantidad}×</strong> ${escapeHtml(
              d.producto_nombre || String(d.producto)
            )}${d.notas ? ` <em>(${escapeHtml(d.notas)})</em>` : ""}</li>`
        )
        .join("");
      return `
      <article class="pedido-card">
        <h3>Pedido #${p.id} · ${money(p.total)}</h3>
        <p><strong>${escapeHtml(p.nombre_cliente)}</strong> · ${escapeHtml(p.telefono)}</p>
        <p class="sub">
          ${escapeHtml(p.tipo_entrega)}${
            p.direccion ? ` · ${escapeHtml(p.direccion)}` : ""
          } · Pagado Webpay
        </p>
        ${p.notas ? `<p class="sub">Nota: ${escapeHtml(p.notas)}</p>` : ""}
        <ul class="pedido-items">${items || "<li>Sin ítems</li>"}</ul>
        <div class="pedido-actions">
          <button type="button" class="btn btn-mint" data-comanda-pedido="${p.id}" style="width:auto">Comanda</button>
          <button type="button" class="btn btn-primary" data-recibir-pedido="${p.id}" style="width:auto">Recibido</button>
        </div>
      </article>`;
    })
    .join("");

  return `
    <section class="panel">
      <h2>Pedidos web</h2>
      <p class="sub">Solo pedidos ya pagados con Webpay. Imprime la comanda y márcalo recibido.</p>
      <div class="row-actions">
        <button class="btn btn-mint" id="btn-reload-pedidos" type="button">Actualizar</button>
      </div>
      ${
        cards ||
        `<p class="muted" style="margin-top:12px">No hay pedidos pendientes. Se actualiza sola cada 10 s.</p>`
      }
    </section>
  `;
}

function beepNuevoPedido() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 220);
  } catch {
    /* ignore */
  }
}

function pedidoAVentaNorm(p) {
  const notaParts = [
    `Cliente: ${p.nombre_cliente}`,
    `Tel: ${p.telefono}`,
  ];
  if (p.tipo_entrega === "delivery" && p.direccion) {
    notaParts.push(`Dirección: ${p.direccion}`);
  }
  if (p.notas) notaParts.push(p.notas);
  return {
    id: p.id,
    fecha_hora: p.creado_en || new Date().toISOString(),
    metodo_pago: "webpay",
    tipo_entrega: p.tipo_entrega,
    cobro_delivery: Number(p.cobro_delivery) || 0,
    total: Number(p.total) || 0,
    estado: "pagado",
    notas: notaParts.join(" || "),
    cajero: "web",
    detalles: (p.detalles || []).map((d) => ({
      nombre: d.producto_nombre || `Producto #${d.producto}`,
      cantidad: d.cantidad,
      subtotal: Number(d.subtotal) || 0,
      notas: d.notas || "",
    })),
  };
}

async function refreshPedidos({ silent = true } = {}) {
  if (!state.user || !getTokens() || !state.online) return;
  try {
    const lista = await api.pedidos();
    const ids = new Set(lista.map((p) => p.id));
    const nuevos = lista.filter((p) => !state.pedidosKnownIds.has(p.id));
    if (state.pedidosKnownIds.size && nuevos.length) {
      beepNuevoPedido();
      if (silent) toast(`${nuevos.length} pedido(s) web nuevo(s)`);
    }
    state.pedidos = lista;
    state.pedidosKnownIds = ids;
    if (state.view === "pedidos" || nuevos.length) render();
  } catch (e) {
    if (!silent) toast(e.message, true);
  }
}

function startPedidosPolling() {
  stopPedidosPolling();
  refreshPedidos({ silent: true });
  state.pedidosPollTimer = setInterval(() => refreshPedidos({ silent: true }), 10000);
}

function stopPedidosPolling() {
  if (state.pedidosPollTimer) {
    clearInterval(state.pedidosPollTimer);
    state.pedidosPollTimer = null;
  }
}

function renderInventario() {
  const enInventario = new Set(state.inventario.map((i) => i.producto));
  const disponibles = state.productos.filter((p) => !enInventario.has(p.id));
  const isAdmin = state.user?.rol === "administrador";

  const rows = state.inventario
    .map(
      (i) => `
      <tr>
        <td>${escapeHtml(i.producto_nombre)}</td>
        <td>${escapeHtml(i.producto_categoria || "—")}</td>
        <td>${money(i.producto_precio)}</td>
        <td>${escapeHtml(i.producto_estado || "—")}</td>
        <td>${escapeHtml(i.notas || "—")}</td>
        <td>
          ${
            isAdmin
              ? `<button class="btn btn-danger" data-quitar-inv="${i.id}" type="button">Quitar</button>`
              : "—"
          }
        </td>
      </tr>
    `
    )
    .join("");

  const opciones = disponibles
    .map(
      (p) =>
        `<option value="${p.id}">${escapeHtml(p.nombre)} (${escapeHtml(p.categoria)})</option>`
    )
    .join("");

  return `
    <section class="panel">
      <h2>Inventario</h2>
      <p class="sub">Solo aparecen productos que el administrador agregue aquí.</p>
      ${
        isAdmin
          ? `
        <form id="form-agregar-inv" class="row-actions" style="align-items:end">
          <div class="field" style="margin:0;flex:1;min-width:220px">
            <label for="producto-inv">Agregar al inventario</label>
            <select id="producto-inv" required ${disponibles.length ? "" : "disabled"}>
              <option value="">${disponibles.length ? "Selecciona un producto…" : "No hay productos disponibles"}</option>
              ${opciones}
            </select>
          </div>
          <div class="field" style="margin:0;flex:1;min-width:180px">
            <label for="notas-inv">Notas (opcional)</label>
            <input id="notas-inv" type="text" placeholder="Ej. proveedor, ubicación…" />
          </div>
          <button class="btn btn-primary" type="submit" style="width:auto" ${disponibles.length ? "" : "disabled"}>
            Agregar
          </button>
        </form>
      `
          : ""
      }
      <div style="overflow:auto;margin-top:16px">
        <table class="table">
          <thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Estado</th><th>Notas</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="muted">Inventario vacío. El admin debe agregar productos.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderReportes() {
  const r = state.reporte;
  const productos = (r?.por_producto || [])
    .map(
      (p) => `
      <tr>
        <td>${escapeHtml(p.nombre)}</td>
        <td>${p.cantidad}</td>
        <td>${money(p.monto)}</td>
      </tr>`
    )
    .join("");

  return `
    <section class="panel">
      <h2>Reportes por día</h2>
      <p class="sub">Ventas completadas, medios de pago y productos más vendidos.</p>
      <div class="row-actions" style="align-items:end">
        <div class="field" style="margin:0">
          <label for="reporte-fecha">Fecha</label>
          <input id="reporte-fecha" type="date" value="${escapeHtml(state.reporteFecha)}" />
        </div>
        <button class="btn btn-mint" id="btn-cargar-reporte" type="button" style="width:auto">Ver reporte</button>
        <button class="btn btn-ghost" id="btn-print-reporte" type="button" style="width:auto" ${r ? "" : "disabled"}>Imprimir</button>
      </div>
      ${
        r
          ? `
        <div class="stats" style="margin-top:16px">
          <div class="stat"><div class="label">Fecha</div><div class="value" style="font-size:1rem;color:var(--text)">${escapeHtml(r.fecha)}</div></div>
          <div class="stat"><div class="label">Ventas</div><div class="value">${r.cantidad_ventas}</div></div>
          <div class="stat"><div class="label">Anuladas</div><div class="value">${r.cantidad_anuladas}</div></div>
          <div class="stat"><div class="label">Efectivo</div><div class="value">${money(r.total_efectivo)}</div></div>
          <div class="stat"><div class="label">Tarjetas</div><div class="value">${money(r.total_tarjetas)}</div></div>
          <div class="stat"><div class="label">Transferencias</div><div class="value">${money(r.total_transferencias)}</div></div>
          <div class="stat"><div class="label">Webpay</div><div class="value">${money(r.total_webpay)}</div></div>
          <div class="stat"><div class="label">Total</div><div class="value">${money(r.total_general)}</div></div>
          <div class="stat"><div class="label">Retiro / Delivery</div><div class="value" style="font-size:1rem">${r.por_entrega?.retiro ?? 0} / ${r.por_entrega?.delivery ?? 0}</div></div>
        </div>
        <h3 class="section-title" style="margin-top:8px">Por producto</h3>
        <div style="overflow:auto">
          <table class="table">
            <thead><tr><th>Producto</th><th>Cant.</th><th>Monto</th></tr></thead>
            <tbody>${productos || `<tr><td colspan="3" class="muted">Sin ventas ese día.</td></tr>`}</tbody>
          </table>
        </div>
      `
          : `<p class="muted" style="margin-top:16px">Elige una fecha y toca Ver reporte.</p>`
      }
    </section>
  `;
}

function renderCaja() {
  const p = state.cajaPreview;
  return `
    <section class="panel">
      <h2>Cierre de caja</h2>
      <p class="sub">Totales calculados desde ventas completadas del día.</p>
      ${
        p
          ? `
        <div class="stats">
          <div class="stat"><div class="label">Fecha</div><div class="value" style="font-size:1rem;color:var(--text)">${escapeHtml(p.fecha)}</div></div>
          <div class="stat"><div class="label">Efectivo</div><div class="value">${money(p.total_efectivo)}</div></div>
          <div class="stat"><div class="label">Tarjetas</div><div class="value">${money(p.total_tarjetas)}</div></div>
          <div class="stat"><div class="label">Transferencias</div><div class="value">${money(p.total_transferencias)}</div></div>
          <div class="stat"><div class="label">Webpay</div><div class="value">${money(p.total_webpay)}</div></div>
          <div class="stat"><div class="label">Total</div><div class="value">${money(p.total_general)}</div></div>
          <div class="stat"><div class="label">Ventas</div><div class="value">${p.cantidad_ventas}</div></div>
        </div>
      `
          : `<p class="muted">Cargando preview…</p>`
      }
      <div class="row-actions">
        <button class="btn btn-mint" id="btn-preview-caja" type="button">Actualizar preview</button>
        <button class="btn btn-primary" id="btn-cerrar-caja" type="button" style="width:auto">Cerrar caja de hoy</button>
      </div>
    </section>
  `;
}

function render() {
  if (!state.user || !getTokens()) {
    renderLogin();
    return;
  }

  let content = "";
  if (state.view === "pos") content = renderPos();
  if (state.view === "pedidos") content = renderPedidos();
  if (state.view === "ventas") content = renderVentas();
  if (state.view === "inventario") content = renderInventario();
  if (state.view === "caja") content = renderCaja();
  if (state.view === "reportes") content = renderReportes();

  app.innerHTML = shell(content);
  bindShell();
}

function bindShell() {
  document.getElementById("btn-logout")?.addEventListener("click", () => {
    clearSession();
    state.user = null;
    state.cart = [];
    stopPedidosPolling();
    state.pedidos = [];
    state.pedidosKnownIds = new Set();
    render();
  });

  document.getElementById("btn-sync")?.addEventListener("click", () => trySync(true));

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.view = btn.dataset.view;
      try {
        if (state.view === "pedidos") {
          await refreshPedidos({ silent: false });
        }
        if (state.view === "ventas") {
          state.ventas = await api.ventas();
          state.ventaDetalle = null;
        }
        if (state.view === "inventario") {
          state.inventario = await api.inventario();
          state.productos = await api.productos();
        }
        if (state.view === "caja") state.cajaPreview = await api.cajaPreview();
        if (state.view === "reportes") {
          state.reporte = await api.reporteDiario(state.reporteFecha);
        }
      } catch (e) {
        toast(e.message, true);
      }
      render();
    });
  });

  document.getElementById("btn-reload-pedidos")?.addEventListener("click", () =>
    refreshPedidos({ silent: false })
  );

  document.querySelectorAll("[data-comanda-pedido]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.comandaPedido);
      const p = state.pedidos.find((x) => x.id === id);
      if (!p) return;
      if (!imprimirComandaCocina(pedidoAVentaNorm(p))) {
        toast("Permite ventanas emergentes para imprimir", true);
      }
    });
  });

  document.querySelectorAll("[data-recibir-pedido]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.recibirPedido);
      try {
        await api.recibirPedido(id);
        toast(`Pedido #${id} recibido`);
        await refreshPedidos({ silent: true });
        render();
      } catch (e) {
        toast(e.message, true);
      }
    });
  });

  document.querySelectorAll("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.categoria = btn.dataset.cat;
      render();
    });
  });

  document.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.add);
      const p = state.productos.find((x) => x.id === id);
      if (!p) return;

      // Tablas: modal de personalización → Agregar desde ahí
      if (esTabla(p)) {
        const rolls = rollsDeTabla(p.nombre).map((roll, i) => ({
          id: i,
          env: roll.env,
          ingredientes: roll.ingredientes.map((nombre) => ({
            nombre,
            incluido: true,
          })),
        }));
        state.tablaConfig = { producto: p, rolls, nota: "" };
        state.shawarmaConfig = null;
        state.confirmSalsa = null;
        state.addModal = null;
        state.cartOpen = false;
        render();
        return;
      }

      // Shawarmas: ingredientes + salsas
      if (esShawarma(p)) {
        const parsed = parseIngredientesShawarma(p);
        const salsas = Object.fromEntries(SALSAS_SHAWARMA.map((s) => [s, false]));
        salsas.Ajo = true; // 1 incluida por defecto
        state.shawarmaConfig = {
          producto: p,
          ings: parsed.fijos.map((nombre) => ({ nombre, incluido: true })),
          eligeProteina: parsed.eligeProteina,
          proteinaOpciones: parsed.proteinaOpciones,
          proteina: parsed.eligeProteina ? null : null,
          salsas,
          cantidad: 1,
        };
        state.tablaConfig = null;
        state.confirmSalsa = null;
        state.addModal = null;
        state.cartOpen = false;
        render();
        return;
      }

      // Resto: modal solo cantidad
      state.addModal = { producto: p, cantidad: 1, nota: "", conPalta: false };
      state.tablaConfig = null;
      state.shawarmaConfig = null;
      state.cartOpen = false;
      render();
    });
  });

  // Modal agregar ítem simple
  document.getElementById("btn-cerrar-add")?.addEventListener("click", () => {
    state.addModal = null;
    render();
  });
  document.getElementById("add-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "add-overlay") {
      state.addModal = null;
      render();
    }
  });
  document.getElementById("btn-add-dec")?.addEventListener("click", () => {
    const input = document.getElementById("add-cantidad");
    if (!input) return;
    input.value = String(Math.max(1, (Number(input.value) || 1) - 1));
  });
  document.getElementById("btn-add-inc")?.addEventListener("click", () => {
    const input = document.getElementById("add-cantidad");
    if (!input) return;
    input.value = String(Math.max(1, (Number(input.value) || 1) + 1));
  });
  document.getElementById("add-palta")?.addEventListener("change", (e) => {
    if (!state.addModal) return;
    state.addModal.conPalta = e.target.checked;
    const qty = Number(document.getElementById("add-cantidad")?.value) || 1;
    state.addModal.cantidad = Math.max(1, qty);
    render();
  });
  document.getElementById("btn-add-confirmar")?.addEventListener("click", () => {
    const cfg = state.addModal;
    if (!cfg) return;
    const p = cfg.producto;
    const cantidad = Math.max(
      1,
      Number(document.getElementById("add-cantidad")?.value) || 1
    );
    const conPalta = p.categoria === "ceviches" && Boolean(cfg.conPalta);
    if (conPalta && !idPaltaExtra()) {
      toast("Falta el producto «Palta extra» en la carta. Ejecuta seed_menu.", true);
      return;
    }
    const unit = Number(p.precio) + (conPalta ? PRECIO_PALTA_EXTRA : 0);
    const line = state.cart.find(
      (l) =>
        l.producto === p.id &&
        !l.rolls &&
        !l.shawarma &&
        !l.nota &&
        Boolean(l.conPalta) === conPalta
    );
    if (line) line.cantidad += cantidad;
    else
      state.cart.push({
        producto: p.id,
        nombre: p.nombre,
        precio: unit,
        precioBase: Number(p.precio),
        cantidad,
        categoria: p.categoria,
        descripcion: p.descripcion || "",
        conPalta,
        extrasPalta: conPalta ? 1 : 0,
        nota: conPalta ? "Con palta extra" : "",
      });
    state.addModal = null;
    render();
  });

  // Configurador de tablas (quitar ingredientes por roll)
  document.querySelectorAll("[data-toggle-ing]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [rIdx, iIdx] = btn.dataset.toggleIng.split(":").map(Number);
      const ing = state.tablaConfig?.rolls?.[rIdx]?.ingredientes?.[iIdx];
      if (!ing) return;
      const roll = state.tablaConfig.rolls[rIdx];
      const activos = roll.ingredientes.filter((x) => x.incluido).length;
      if (ing.incluido && activos <= 1) {
        toast("Deja al menos un ingrediente en el roll", true);
        return;
      }
      ing.incluido = !ing.incluido;
      syncIngToggleEl(btn, ing.incluido, ing.nombre);
    });
  });
  document.getElementById("btn-cerrar-tabla")?.addEventListener("click", () => {
    cerrarTablaModal();
  });
  document.getElementById("tabla-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "tabla-overlay") cerrarTablaModal();
  });
  document.getElementById("btn-tabla-todos")?.addEventListener("click", () => {
    if (!state.tablaConfig) return;
    state.tablaConfig.rolls.forEach((roll) => {
      roll.ingredientes.forEach((ing) => {
        ing.incluido = true;
      });
    });
    syncTablaIngsUI();
  });
  document.getElementById("btn-tabla-confirmar")?.addEventListener("click", () => {
    const cfg = state.tablaConfig;
    if (!cfg) return;
    const p = cfg.producto;
    const rolls = cfg.rolls.map((roll) => {
      const incluidos = roll.ingredientes.filter((i) => i.incluido).map((i) => i.nombre);
      const quitados = roll.ingredientes.filter((i) => !i.incluido).map((i) => i.nombre);
      return {
        env: roll.env,
        label: labelRoll(roll),
        incluidos,
        quitados,
      };
    });
    const resumen_quitados = rolls
      .filter((r) => r.quitados.length)
      .map((r) => `${r.env} sin ${r.quitados.join(", ")}`);

    state.cart.push({
      producto: p.id,
      nombre: p.nombre,
      precio: Number(p.precio),
      cantidad: 1,
      categoria: p.categoria,
      descripcion: p.descripcion || "",
      rolls,
      rolls_quitados: resumen_quitados,
    });
    cerrarTablaModal();
  });

  // Configurador shawarmas
  document.querySelectorAll("[data-toggle-shawarma-ing]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const iIdx = Number(btn.dataset.toggleShawarmaIng);
      const ing = state.shawarmaConfig?.ings?.[iIdx];
      if (!ing) return;
      const activos = state.shawarmaConfig.ings.filter((x) => x.incluido).length;
      const tieneProteina = Boolean(state.shawarmaConfig.proteina);
      if (ing.incluido && activos <= 1 && !state.shawarmaConfig.eligeProteina) {
        toast("Deja al menos un ingrediente", true);
        return;
      }
      if (ing.incluido && activos <= 0 && state.shawarmaConfig.eligeProteina && !tieneProteina) {
        toast("Deja al menos un ingrediente o la proteína", true);
        return;
      }
      ing.incluido = !ing.incluido;
      syncIngToggleEl(btn, ing.incluido, ing.nombre);
    });
  });
  document.querySelectorAll("[data-salsa-btn]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.shawarmaConfig) return;
      const salsa = btn.dataset.salsaBtn;
      const yaOn = Boolean(state.shawarmaConfig.salsas[salsa]);
      if (yaOn) {
        state.shawarmaConfig.salsas[salsa] = false;
        syncSalsaUI();
        return;
      }
      const actuales = SALSAS_SHAWARMA.filter((s) => state.shawarmaConfig.salsas[s]);
      if (actuales.length >= 1) {
        showConfirmSalsa(salsa);
        return;
      }
      state.shawarmaConfig.salsas[salsa] = true;
      syncSalsaUI();
    });
  });
  document.getElementById("btn-salsa-si")?.addEventListener("click", () => {
    if (!state.shawarmaConfig || !state.confirmSalsa) return;
    state.shawarmaConfig.salsas[state.confirmSalsa.salsa] = true;
    hideConfirmSalsa();
    syncSalsaUI();
  });
  document.getElementById("btn-salsa-no")?.addEventListener("click", () => {
    hideConfirmSalsa();
  });
  document.getElementById("confirm-salsa-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "confirm-salsa-overlay") hideConfirmSalsa();
  });
  document.querySelectorAll("[data-proteina]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.shawarmaConfig) return;
      state.shawarmaConfig.proteina = btn.dataset.proteina;
      syncProteinaUI();
    });
  });
  document.getElementById("btn-cerrar-shawarma")?.addEventListener("click", () => {
    cerrarShawarmaModal();
  });
  document.getElementById("shawarma-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "shawarma-overlay") cerrarShawarmaModal();
  });
  document.getElementById("btn-shawarma-dec")?.addEventListener("click", () => {
    if (!state.shawarmaConfig) return;
    state.shawarmaConfig.cantidad = Math.max(1, (state.shawarmaConfig.cantidad || 1) - 1);
    syncShawarmaPrecio();
  });
  document.getElementById("btn-shawarma-inc")?.addEventListener("click", () => {
    if (!state.shawarmaConfig) return;
    state.shawarmaConfig.cantidad = Math.max(1, (state.shawarmaConfig.cantidad || 1) + 1);
    syncShawarmaPrecio();
  });
  document.getElementById("shawarma-cantidad")?.addEventListener("change", (e) => {
    if (!state.shawarmaConfig) return;
    state.shawarmaConfig.cantidad = Math.max(1, Number(e.target.value) || 1);
    syncShawarmaPrecio();
  });
  document.getElementById("btn-shawarma-reset")?.addEventListener("click", () => {
    if (!state.shawarmaConfig) return;
    hideConfirmSalsa();
    resetShawarmaConfigDefaults(state.shawarmaConfig);
    syncShawarmaIngsUI();
    syncProteinaUI();
    syncSalsaUI();
  });
  document.getElementById("btn-shawarma-confirmar")?.addEventListener("click", () => {
    const cfg = state.shawarmaConfig;
    if (!cfg) return;
    const p = cfg.producto;
    if (cfg.eligeProteina && !cfg.proteina) {
      toast("Elige Carne o Pollo", true);
      return;
    }
    const salsasSel = SALSAS_SHAWARMA.filter((s) => cfg.salsas[s]);
    if (!salsasSel.length) {
      toast("Elige al menos una salsa (la primera va incluida)", true);
      return;
    }
    const ingsIncluidos = cfg.ings.filter((i) => i.incluido).map((i) => i.nombre);
    if (!ingsIncluidos.length && !cfg.proteina) {
      toast("Deja al menos un ingrediente", true);
      return;
    }
    const cantidad = Math.max(
      1,
      Number(document.getElementById("shawarma-cantidad")?.value) || cfg.cantidad || 1
    );
    const extras = extrasSalsaCount(salsasSel);
    const unit = precioUnitarioShawarma(p.precio, salsasSel);
    if (extras > 0 && !idSalsaExtra()) {
      toast("Falta el producto «Salsa extra» en la carta. Ejecuta seed_menu.", true);
      return;
    }
    const shawarmaLabel = labelShawarmaLinea({
      ingredientes: ingsIncluidos,
      proteina: cfg.proteina,
      salsas: salsasSel,
      extras,
    });

    state.cart.push({
      producto: p.id,
      nombre: p.nombre,
      precio: unit,
      precioBase: Number(p.precio),
      cantidad,
      categoria: p.categoria,
      descripcion: p.descripcion || "",
      shawarma: shawarmaLabel,
      salsas: salsasSel,
      extrasSalsa: extras,
      ingsShawarma: ingsIncluidos,
      proteina: cfg.proteina || "",
    });
    cerrarShawarmaModal();
  });

  const openPedido = () => {
    state.cartOpen = true;
    render();
  };
  const closePedido = () => {
    state.cartOpen = false;
    render();
  };
  document.getElementById("btn-abrir-pedido")?.addEventListener("click", openPedido);
  document.getElementById("btn-ampliar-pedido")?.addEventListener("click", openPedido);
  document.getElementById("btn-cerrar-pedido")?.addEventListener("click", closePedido);
  document.getElementById("pedido-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "pedido-overlay") closePedido();
  });

  document.querySelectorAll("[data-inc]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.cart[Number(btn.dataset.inc)].cantidad += 1;
      render();
    });
  });
  document.querySelectorAll("[data-dec]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.dec);
      state.cart[i].cantidad -= 1;
      if (state.cart[i].cantidad <= 0) state.cart.splice(i, 1);
      render();
    });
  });
  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.cart.splice(Number(btn.dataset.del), 1);
      render();
    });
  });

  document.getElementById("metodo_pago")?.addEventListener("change", (e) => {
    state.metodo_pago = e.target.value;
  });
  document.getElementById("tipo_entrega")?.addEventListener("change", (e) => {
    state.tipo_entrega = e.target.value;
    if (state.tipo_entrega === "retiro") {
      state.cobro_delivery = 0;
      state.direccion_delivery = "";
    } else if (!state.cobro_delivery) {
      state.cobro_delivery = 1500;
    }
    render();
  });
  document.getElementById("cobro_delivery")?.addEventListener("change", (e) => {
    state.cobro_delivery = Number(e.target.value) || 0;
    render();
  });

  document.getElementById("direccion_delivery")?.addEventListener("input", (e) => {
    state.direccion_delivery = e.target.value;
  });

  document.getElementById("nota_pedido")?.addEventListener("input", (e) => {
    state.nota_pedido = e.target.value;
  });

  document.getElementById("btn-limpiar")?.addEventListener("click", () => {
    state.cart = [];
    state.cartOpen = false;
    state.nota_pedido = "";
    state.direccion_delivery = "";
    render();
  });

  document.getElementById("btn-cobrar")?.addEventListener("click", cobrar);

  document.getElementById("btn-reload-ventas")?.addEventListener("click", async () => {
    try {
      state.ventas = await api.ventas();
      render();
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.querySelectorAll("[data-detalle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.detalle);
      state.ventaDetalle = state.ventas.find((v) => v.id === id) || null;
      render();
    });
  });

  document.getElementById("btn-cerrar-detalle")?.addEventListener("click", () => {
    state.ventaDetalle = null;
    render();
  });
  document.getElementById("detalle-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "detalle-overlay") {
      state.ventaDetalle = null;
      render();
    }
  });

  document.getElementById("btn-detalle-ticket")?.addEventListener("click", () => {
    if (!state.ventaDetalle) return;
    const norm = normalizarVentaParaTicket(state.ventaDetalle);
    if (!imprimirTicketCliente(norm)) toast("Permite ventanas emergentes para imprimir", true);
  });
  document.getElementById("btn-detalle-cocina")?.addEventListener("click", () => {
    if (!state.ventaDetalle) return;
    const norm = normalizarVentaParaTicket(state.ventaDetalle);
    if (!imprimirComandaCocina(norm)) toast("Permite ventanas emergentes para imprimir", true);
  });
  document.getElementById("btn-detalle-anular")?.addEventListener("click", async () => {
    if (!state.ventaDetalle || !confirm("¿Anular esta venta?")) return;
    try {
      await api.anularVenta(state.ventaDetalle.id);
      state.ventas = await api.ventas();
      state.ventaDetalle = null;
      toast("Venta anulada");
      render();
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("btn-cerrar-postcobro")?.addEventListener("click", () => {
    state.postCobro = null;
    render();
  });
  document.getElementById("postcobro-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "postcobro-overlay") {
      state.postCobro = null;
      render();
    }
  });
  document.getElementById("btn-print-ticket")?.addEventListener("click", () => {
    if (!state.postCobro) return;
    if (!imprimirTicketCliente(state.postCobro)) {
      toast("Permite ventanas emergentes para imprimir", true);
    }
  });
  document.getElementById("btn-print-cocina")?.addEventListener("click", () => {
    if (!state.postCobro) return;
    if (!imprimirComandaCocina(state.postCobro)) {
      toast("Permite ventanas emergentes para imprimir", true);
    }
  });

  document.getElementById("btn-cargar-reporte")?.addEventListener("click", async () => {
    const input = document.getElementById("reporte-fecha");
    state.reporteFecha = input?.value || state.reporteFecha;
    try {
      state.reporte = await api.reporteDiario(state.reporteFecha);
      render();
    } catch (e) {
      toast(e.message, true);
    }
  });
  document.getElementById("btn-print-reporte")?.addEventListener("click", () => {
    if (!state.reporte) return;
    imprimirReporteDiario(state.reporte);
  });

  document.getElementById("form-agregar-inv")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const producto = Number(document.getElementById("producto-inv").value);
    const notas = document.getElementById("notas-inv").value.trim();
    if (!producto) return;
    try {
      await api.agregarInventario({ producto, notas });
      state.inventario = await api.inventario();
      toast("Producto agregado al inventario");
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.querySelectorAll("[data-quitar-inv]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Quitar este producto del inventario?")) return;
      try {
        await api.quitarInventario(btn.dataset.quitarInv);
        state.inventario = await api.inventario();
        toast("Quitado del inventario");
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  document.getElementById("btn-preview-caja")?.addEventListener("click", async () => {
    try {
      state.cajaPreview = await api.cajaPreview();
      render();
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("btn-cerrar-caja")?.addEventListener("click", async () => {
    const fecha = state.cajaPreview?.fecha || fechaLocalHoy();
    try {
      await api.cerrarCaja(fecha);
      toast(`Caja cerrada: ${fecha}`);
      state.cajaPreview = await api.cajaPreview(fecha);
      render();
    } catch (e) {
      toast(e.message, true);
    }
  });
}

async function cobrar() {
  if (!state.cart.length) {
    toast("Agrega al menos un producto para enviar el pedido", true);
    return;
  }

  if (state.tipo_entrega === "delivery") {
    const dir = (state.direccion_delivery || "").trim();
    if (!dir) {
      toast("Indica la dirección de delivery", true);
      document.getElementById("direccion_delivery")?.focus();
      return;
    }
    state.direccion_delivery = dir;
  }

  // Abrir ventanas en el mismo clic (antes del await) para no bloquear popups
  const ventanasPrint = prepararVentanasImpresion();

  const notaParts = [];
  if (state.tipo_entrega === "delivery" && state.direccion_delivery.trim()) {
    notaParts.push(`Dirección: ${state.direccion_delivery.trim()}`);
  }
  if ((state.nota_pedido || "").trim()) {
    notaParts.push(state.nota_pedido.trim());
  }
  const notasPedido = notaParts.join(" || ");

  const payload = {
    client_uuid: crypto.randomUUID(),
    fecha_hora: new Date().toISOString(),
    cajero_id: state.user?.id ?? null,
    metodo_pago: state.metodo_pago,
    tipo_entrega: state.tipo_entrega,
    cobro_delivery: state.tipo_entrega === "delivery" ? String(state.cobro_delivery || 0) : "0",
    detalles: state.cart.flatMap((l) => {
      let notas = "";
      if (l.rolls?.length) {
        notas = l.rolls
          .map((r) => {
            const base = r.label || `${r.env}`;
            return r.quitados?.length ? `${base}` : base;
          })
          .join(" | ");
        if (l.rolls_quitados?.length) {
          notas += ` || Cambios: ${l.rolls_quitados.join(" ; ")}`;
        }
      }
      if (l.shawarma) {
        notas = l.shawarma;
      }
      if (l.nota) {
        notas = notas ? `${notas} || ${l.nota}` : l.nota;
      }
      const rows = [
        {
          producto: l.producto,
          cantidad: l.cantidad,
          nombre: l.nombre,
          precio: l.precioBase != null ? l.precioBase : l.precio,
          notas,
          rolls: l.rolls || [],
          rolls_quitados: l.rolls_quitados || [],
        },
      ];
      const extras = Number(l.extrasSalsa) || 0;
      if (extras > 0) {
        const salsaId = idSalsaExtra();
        if (salsaId) {
          rows.push({
            producto: salsaId,
            cantidad: extras * l.cantidad,
            nombre: "Salsa extra",
            precio: PRECIO_SALSA_EXTRA,
            notas: `Extra(s) de ${l.nombre}: ${(l.salsas || []).join(", ")}`,
            rolls: [],
            rolls_quitados: [],
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
            nombre: "Palta extra",
            precio: PRECIO_PALTA_EXTRA,
            notas: `Palta extra en ${l.nombre}`,
            rolls: [],
            rolls_quitados: [],
          });
        }
      }
      return rows;
    }),
    total_local: cartTotal(),
    notas: notasPedido,
  };

  try {
    let ventaApi = null;
    let offline = false;

    if (state.online) {
      try {
        ventaApi = await api.crearVenta({
          client_uuid: payload.client_uuid,
          metodo_pago: payload.metodo_pago,
          tipo_entrega: payload.tipo_entrega,
          cobro_delivery: payload.cobro_delivery,
          notas: payload.notas,
          detalles: payload.detalles.map((d) => ({
            producto: d.producto,
            cantidad: d.cantidad,
            notas: d.notas || "",
          })),
        });
      } catch (e) {
        // Solo encolar si no hay respuesta del servidor (red). 4xx = rechazo real.
        const status = e?.status;
        if (status && status >= 400 && status < 500) {
          cerrarVentanasImpresion(ventanasPrint);
          toast(e.message || "El servidor rechazó la venta", true);
          return;
        }
        await savePendingSale(payload);
        await refreshPending();
        offline = true;
        toast("Sin respuesta del servidor: venta guardada offline", true);
      }
    } else {
      await savePendingSale(payload);
      await refreshPending();
      offline = true;
      toast("Sin internet: venta guardada en este dispositivo");
    }

    state.cart = [];
    state.cartOpen = false;
    state.nota_pedido = "";
    state.direccion_delivery = "";
    state.postCobro = normalizarVentaParaTicket(ventaApi || payload, {
      offline,
      cajero: state.user?.username,
    });
    if (!offline) toast("Venta registrada");

    const okPrint = imprimirTicketYCocina(state.postCobro, ventanasPrint);
    if (!okPrint) {
      toast("Permite ventanas emergentes para imprimir ticket y cocina", true);
    }

    if (state.online && !offline) {
      try {
        await loadProductos();
      } catch {
        /* ignore */
      }
    }
    render();
  } catch (e) {
    cerrarVentanasImpresion(ventanasPrint);
    toast(e.message || "No se pudo cobrar", true);
  }
}

function imprimirReporteDiario(r) {
  const rows = (r.por_producto || [])
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.nombre)}</td><td>${p.cantidad}</td><td>${money(p.monto)}</td></tr>`
    )
    .join("");
  const html = `<!DOCTYPE html><html lang="es-CL"><head><meta charset="utf-8"/><title>Reporte ${escapeHtml(r.fecha)}</title>
  <style>
    body{font-family:system-ui,sans-serif;padding:24px;color:#111}
    h1{font-size:1.25rem} table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border-bottom:1px solid #ccc;padding:6px 4px;text-align:left;font-size:13px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0;font-size:14px}
  </style></head><body>
  <h1>el Tenedor — Reporte ${escapeHtml(r.fecha)}</h1>
  <div class="grid">
    <div>Ventas: <strong>${r.cantidad_ventas}</strong></div>
    <div>Anuladas: <strong>${r.cantidad_anuladas}</strong></div>
    <div>Efectivo: <strong>${money(r.total_efectivo)}</strong></div>
    <div>Tarjetas: <strong>${money(r.total_tarjetas)}</strong></div>
    <div>Transferencias: <strong>${money(r.total_transferencias)}</strong></div>
    <div>Webpay: <strong>${money(r.total_webpay)}</strong></div>
    <div>Total: <strong>${money(r.total_general)}</strong></div>
    <div>Retiro: <strong>${r.por_entrega?.retiro ?? 0}</strong></div>
    <div>Delivery: <strong>${r.por_entrega?.delivery ?? 0}</strong></div>
  </div>
  <table><thead><tr><th>Producto</th><th>Cant.</th><th>Monto</th></tr></thead>
  <tbody>${rows || "<tr><td colspan=3>Sin ventas</td></tr>"}</tbody></table>
  <script>onload=()=>setTimeout(()=>print(),200)</script>
  </body></html>`;
  const w = window.open("", "_blank", "noopener,noreferrer,width=720,height=800");
  if (!w) {
    toast("Permite ventanas emergentes para imprimir", true);
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

bootstrap();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
