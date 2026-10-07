import "./style.css";
import {
  api,
  clearSession,
  getCachedUser,
  getTokens,
  login,
  register,
  setCachedUser,
} from "./api.js";
import { countPendingSales, savePendingSale } from "./db.js";
import { escapeHtml } from "./dom.js";
import { syncPendingSales, watchConnectivity } from "./sync.js";
import { esTabla, labelRoll, rollsDeTabla } from "./tablas.js";
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
  /** Pantalla de acceso: "login" | "register" */
  authScreen: "login",
  productos: [],
  categoria: "todas",
  cart: [],
  cartOpen: false,
  /** Configurador de tabla: { producto, rolls, nota } */
  tablaConfig: null,
  /** Configurador shawarma: { producto, ings, eligeProteina, proteina, salsas, cantidad } */
  shawarmaConfig: null,
  /** Configurador Arma tu Roll */
  rollConfig: null,
  /** Configurador Arma tu Gohan */
  gohanConfig: null,
  /** Modal agregar ítem simple: { producto, cantidad, nota } */
  addModal: null,
  metodo_pago: "efectivo",
pago_mixto: {
  efectivo: 0,
  debito: 0,
  credito: 0,
  transferencia: 0,
},
tipo_entrega: "retiro",
 
  cobro_delivery: 0,
  /** Tarifas que define el administrador. */
  zonas: [],
  zonasError: "",
  zona_delivery_id: null,
  /** Formulario del modal de Delivery. */
  zonaForm: emptyZonaForm(),
  zonaModalOpen: false,
  /** Formulario modal de productos de la carta (admin). */
  productoForm: emptyProductoForm(),
  productoModalOpen: false,
  cartaFiltro: "todas",
  cartaBusqueda: "",
  /** Configuración de horario de pedidos web (admin). */
  horarioForm: null,
  horarioError: "",
  horarioLoaded: false,
  horarioSaving: false,
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
  cajaCerrada: null,
  reporteFecha: fechaLocalHoy(),
  reporte: null,
  /** Confirmación salsa extra: { salsa } */
  confirmSalsa: null,
  toast: null,
  cliente_nombre:"",
  paga_con: "",
};

function emptyZonaForm() {
  return { id: null, nombre: "", descripcion: "", precio: "" };
}

function emptyProductoForm() {
  return {
    id: null,
    nombre: "",
    descripcion: "",
    precio: "",
    categoria: "picoteo",
    estado: "activo",
  };
}

function zonasActivas() {
  return state.zonas || [];
}

function zonaSeleccionada() {
  return (
    zonasActivas().find((z) => String(z.id) === String(state.zona_delivery_id)) || null
  );
}

function aplicarZona(id) {
  const zona = zonasActivas().find((z) => String(z.id) === String(id));
  if (!zona) {
    state.zona_delivery_id = null;
    state.cobro_delivery = 0;
    return null;
  }
  state.zona_delivery_id = zona.id;
  state.cobro_delivery = Number(zona.precio) || 0;
  return zona;
}

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
  ["rolls", "Arma tu Roll"],
  ["gohan", "Arma tu Gohan"],
  ["bebestibles", "Bebestibles"],
];

/** Incluye agregados solo para editar extras internos (salsa, toppings…), no como sección de venta. */
const CATEGORIAS_PRODUCTO = [
  ...CATEGORIAS.filter(([id]) => id !== "todas"),
  ["agregados", "Agregados"],
];

function labelCategoria(id) {
  return (
    CATEGORIAS.find(([cid]) => cid === id)?.[1] ||
    CATEGORIAS_PRODUCTO.find(([cid]) => cid === id)?.[1] ||
    id ||
    "—"
  );
}

function productosParaCarta() {
  const base = state.productos.filter(
    (p) =>
      p.estado === "activo" &&
      p.categoria !== "agregados" &&
      !esProductoOcultoRoll(p) &&
      !esProductoOcultoGohan(p)
  );
  const card = tarjetaArmaTuRoll(state.productos);
  if (!card) return base;
  const idxTablas = base.findIndex((p) => p.categoria === "tablas");
  const insertAt =
    idxTablas === -1
      ? base.length
      : base.findIndex((p, i) => i > idxTablas && p.categoria !== "tablas");
  const at = insertAt === -1 ? base.length : insertAt;
  return [...base.slice(0, at), card, ...base.slice(at)];
}

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
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(Number(n) || 0));
}

/** Entero CLP para inputs (evita 5000,00 del Decimal de la API). */
function precioInputClp(n) {
  if (n === "" || n == null) return "";
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? String(v) : "";
}

let toastTimer = null;

/** Precio arriba del modal: solo unidad; el total va en el botón. */
function precioModalHeader(unit, extra = "") {
  return `${money(unit)}${extra}`;
}

function formatFecha(fecha) {
  if (!fecha) return "—";

  const partes = String(fecha).split("-");
  if (partes.length !== 3) return fecha;

  const [anio, mes, dia] = partes;

  return `${dia}-${mes}-${anio.slice(-2)}`;
}

function toast(msg, isError = false) {
  state.toast = { msg, isError };
  const existing = document.getElementById("pos-toast");
  existing?.remove();
  const el = document.createElement("div");
  el.id = "pos-toast";
  el.className = `toast ${isError ? "error" : ""}`;
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.remove();
    state.toast = null;
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
      await loadZonas();
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

async function loadZonas() {
  try {
    state.zonas = await api.zonasDelivery();
    state.zonasError = "";
  } catch (e) {
    state.zonasError = e.message || "No se pudieron cargar las zonas de delivery";
  }
}

function renderLogin() {
  app.innerHTML = `
    <section class="login-screen">
      <form class="login-panel" id="login-form">
        ${brandLockup(false)}
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
        <p class="auth-switch">
          ¿No tienes cuenta?
          <button type="button" class="linkish" id="go-register">Registrarse</button>
        </p>
      </form>
    </section>
  `;
  document.getElementById("go-register").addEventListener("click", () => {
    state.authScreen = "register";
    render();
  });
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("login-error");
    err.hidden = true;
    const fd = new FormData(e.target);
    try {
      state.user = await login(fd.get("username"), fd.get("password"));
      await enterAfterAuth();
    } catch (ex) {
      err.textContent = ex.message || "No se pudo iniciar sesión";
      err.hidden = false;
    }
  });
}

function renderRegister() {
  app.innerHTML = `
    <section class="login-screen">
      <form class="login-panel" id="register-form">
        ${brandLockup(false)}
        <div class="field">
          <label for="reg-username">Usuario</label>
          <input id="reg-username" name="username" autocomplete="username" required />
        </div>
        <div class="field">
          <label for="reg-password">Contraseña</label>
          <input id="reg-password" name="password" type="password" autocomplete="new-password" required minlength="8" />
        </div>
        <div class="field">
          <label for="reg-password-confirm">Confirmar contraseña</label>
          <input id="reg-password-confirm" name="password_confirm" type="password" autocomplete="new-password" required minlength="8" />
        </div>
        <button class="btn btn-primary" type="submit">Registrarse</button>
        <p class="error" id="register-error" hidden></p>
        <p class="auth-switch">
          ¿Ya tienes cuenta?
          <button type="button" class="linkish" id="go-login">Entrar</button>
        </p>
      </form>
    </section>
  `;
  document.getElementById("go-login").addEventListener("click", () => {
    state.authScreen = "login";
    render();
  });
  document.getElementById("register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("register-error");
    err.hidden = true;
    const fd = new FormData(e.target);
    const password = String(fd.get("password") || "");
    const password_confirm = String(fd.get("password_confirm") || "");
    if (password !== password_confirm) {
      err.textContent = "Las contraseñas no coinciden.";
      err.hidden = false;
      return;
    }
    try {
      state.user = await register({
        username: String(fd.get("username") || "").trim(),
        password,
        password_confirm,
      });
      state.authScreen = "login";
      await enterAfterAuth();
    } catch (ex) {
      err.textContent = ex.message || "No se pudo crear la cuenta";
      err.hidden = false;
    }
  });
}

async function enterAfterAuth() {
  await loadProductos();
  await loadZonas();
  await refreshPending();
  await trySync(false);
  startPedidosPolling();
  state.view = "pos";
  render();
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
          <button data-view="carta" class="${state.view === "carta" ? "active" : ""}">Carta</button>
          <button data-view="delivery" class="${state.view === "delivery" ? "active" : ""}">Delivery</button>
          <button data-view="horario" class="${state.view === "horario" ? "active" : ""}">Horario</button>
          <button data-view="caja" class="${state.view === "caja" ? "active" : ""}">Caja</button>
          <button data-view="reportes" class="${state.view === "reportes" ? "active" : ""}">Reportes</button>
        `
            : ""
        }
      </nav>
      <main class="main">${content}</main>
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
            l.rollArmado
              ? `<p class="cart-line-desc">${escapeHtml(l.rollArmado)}</p>`
              : ""
          }
          ${
            l.gohanArmado
              ? `<p class="cart-line-desc">${escapeHtml(l.gohanArmado)}</p>`
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
          ${
            l.salsas?.length && (l.rolls?.length || l.categoria === "tablas")
              ? `<p class="cart-line-desc">Salsas: ${escapeHtml(l.salsas.join(", "))}</p>`
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
          <option value="debito" ${state.metodo_pago === "debito" ? "selected" : ""}>Tarjeta débito</option>
          <option value="credito" ${state.metodo_pago === "credito" ? "selected" : ""}>Tarjeta crédito</option>
          <option value="transferencia" ${state.metodo_pago === "transferencia" ? "selected" : ""}>Transferencia</option>
          <option value="mixto" ${state.metodo_pago === "mixto" ? "selected" : ""}>Pago mixto</option>
           
          </select>
        </div>

        
        <div class="field">
          <label>Entrega</label>
          <select id="tipo_entrega">
            <option value="retiro" ${state.tipo_entrega === "retiro" ? "selected" : ""}>Retiro</option>
            <option value="delivery" ${state.tipo_entrega === "delivery" ? "selected" : ""}>Delivery</option>
          </select>
        </div>
        ${
          state.tipo_entrega === "delivery"
            ? `<div class="field">
          <label for="zona_delivery">Zona delivery</label>
          <select id="zona_delivery">
            ${
              zonasActivas().length
                ? zonasActivas()
                    .map(
                      (z) =>
                        `<option value="${z.id}" ${String(state.zona_delivery_id) === String(z.id) ? "selected" : ""}>${escapeHtml(z.nombre)}${z.descripcion ? ` — ${escapeHtml(z.descripcion)}` : ""} · ${money(z.precio)}</option>`
                    )
                    .join("")
                : `<option value="">${state.zonasError ? "No se pudieron cargar" : "Sin zonas configuradas"}</option>`
            }
          </select>
        </div>`
            : ""
        }
      </div>
      ${state.metodo_pago === "Efectivo" || state.metodo_pago === "efectivo" ? `
        <div style="display: flex; gap: 12px; align-items: center; background: #f8f9fa; padding: 10px; border-radius: 8px; margin: 8px 0; border: 1px solid #e2e8f0;">
          <div style="flex: 1.2;">
            <label for="paga_con" style="font-size: 11px; font-weight: bold; text-transform: uppercase; display: block; margin-bottom: 2px;">Paga con ($)</label>
            <input
              type="number"
              id="paga_con"
              placeholder="Ej: 100000"
              value="${state.paga_con || ''}"
              style="width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid #ccc; font-size: 15px; font-weight: 600;"
            />
          </div>
          <div style="flex: 1; text-align: right;">
            <label style="font-size: 11px; font-weight: bold; text-transform: uppercase; color: #5c6b73; display: block;">Vuelto</label>
            <div id="vuelto-display" style="font-size: 17px; font-weight: bold; margin-top: 2px; color: ${ (Number(state.paga_con) || 0) < cartTotal() ? '#d9534f' : '#2e7d32' };">
              ${money(Math.max(0, (Number(state.paga_con) || 0) - cartTotal()))}
            </div>
          </div>
        </div>
      ` : ""}
            ${
        state.metodo_pago === "mixto"
          ? `
      <div class="field" style="margin-top:12px">
        <label>Distribución del pago mixto</label>

        <div class="cart-checkout-row">
          <div class="field">
            <label for="pago-mixto-efectivo">Efectivo</label>
            <input
              id="pago-mixto-efectivo"
              data-pago-mixto="efectivo"
              type="number"
              min="0"
              step="100"
              value="${state.pago_mixto.efectivo || 0}"
            />
          </div>

          <div class="field">
            <label for="pago-mixto-debito">Débito</label>
            <input
              id="pago-mixto-debito"
              data-pago-mixto="debito"
              type="number"
              min="0"
              step="100"
              value="${state.pago_mixto.debito || 0}"
            />
          </div>

          <div class="field">
            <label for="pago-mixto-credito">Crédito</label>
            <input
              id="pago-mixto-credito"
              data-pago-mixto="credito"
              type="number"
              min="0"
              step="100"
              value="${state.pago_mixto.credito || 0}"
            />
          </div>

          <div class="field">
            <label for="pago-mixto-transferencia">Transferencia</label>
            <input
              id="pago-mixto-transferencia"
              data-pago-mixto="transferencia"
              type="number"
              min="0"
              step="100"
              value="${state.pago_mixto.transferencia || 0}"
            />
          </div>
        </div>

        <p id="resumen-pago-mixto" class="sub" style="margin-top:8px">
          Ingresado:
          ${money(
            Object.values(state.pago_mixto).reduce(
              (total, monto) => total + (Number(monto) || 0),
              0
            )
          )}
          · Total venta: ${money(cartTotal())}
        </p>
      </div>`
          : ""
      }
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
        <label for="cliente_nombre">Nombre del cliente</label>
        <input 
          type="text" 
          id="cliente_nombre" 
          placeholder="Ej: Juan Pérez / Mesa 3" 
          value="${escapeHtml(state.cliente_nombre || '')}" 
        />
      </div>
      <div class="field">
        <label for="nota_pedido">Nota del pedido</label>
        <textarea id="nota_pedido" rows="2" placeholder="Ej. sin cubiertos, tocar timbre, alergia…">${escapeHtml(state.nota_pedido)}</textarea>
      </div>
      <div class="cart-total"><span>Total</span><span class="price-tag">${money(cartTotal())}</span></div>${
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
    el.textContent = precioModalHeader(
      unit,
      extras ? ` · incluye ${extras} salsa(s) extra` : ""
    );
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
  cfg.masa = MASA_DEFAULT;
  cfg.salsas = Object.fromEntries(SALSAS_SHAWARMA.map((s) => [s, false]));
  cfg.salsas.Ajo = true;
  cfg.cantidad = 1;
}

function syncMasaUI() {
  const cfg = state.shawarmaConfig;
  if (!cfg) return;
  document.querySelectorAll("[data-masa]").forEach((btn) => {
    syncChoiceBox(btn, cfg.masa === btn.dataset.masa);
  });
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

function abrirRollModal() {
  const envOpts = envolturasDisponibles(state.productos);
  if (!envOpts.length) {
    toast("Falta cargar Arma tu Roll. Ejecuta seed_menu.", true);
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
  state.tablaConfig = null;
  state.shawarmaConfig = null;
  state.confirmSalsa = null;
  state.addModal = null;
  state.cartOpen = false;
  render();
}

function cerrarRollModal() {
  state.rollConfig = null;
  render();
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
  const precioEl = document.getElementById("roll-precio");
  if (precioEl) {
    precioEl.textContent = precioModalHeader(
      unit,
      salsas.length ? ` · ${salsas.length} salsa(s)` : ""
    );
  }
  const input = document.getElementById("roll-cantidad");
  if (input) input.value = String(cant);
  document.querySelectorAll("[data-roll-env]").forEach((btn) => {
    const on = btn.dataset.rollEnv === cfg.envoltura;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll("[data-roll-relleno]").forEach((btn) => {
    const on = btn.dataset.rollRelleno === cfg.relleno;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll("[data-roll-acomp]").forEach((btn) => {
    const tipo = btn.dataset.rollAcomp;
    const on =
      (tipo === "queso" && cfg.acompanamientoTipo === "queso") ||
      (tipo === "vegetal" &&
        cfg.acompanamientoTipo === "vegetal" &&
        cfg.vegetal === btn.dataset.rollVegetal);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll("[data-roll-topping]").forEach((btn) => {
    const on = Boolean(cfg.toppings[btn.dataset.rollTopping]);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll("[data-roll-salsa]").forEach((btn) => {
    const on = Boolean(cfg.salsas[btn.dataset.rollSalsa]);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  const confirm = document.getElementById("btn-roll-confirmar");
  if (confirm) confirm.disabled = !rollConfigCompleta(cfg);
}

function renderRollModal() {
  const cfg = state.rollConfig;
  if (!cfg) return "";
  const { envOpts, topOpts, unit, cant, salsas } = rollModalSnapshot(cfg);
  const completa = rollConfigCompleta(cfg);
  return `
    <div class="pedido-overlay" id="roll-overlay" role="dialog" aria-modal="true">
      <div class="pedido-modal tabla-modal">
        <header class="pedido-modal-head">
          <div>
            <p class="pedido-kicker">Arma tu Roll</p>
            <h2>Personalizar roll</h2>
            <p class="tabla-precio" id="roll-precio">${precioModalHeader(
              unit,
              salsas.length ? ` · ${salsas.length} salsa(s)` : ""
            )}</p>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-roll" aria-label="Cerrar">×</button>
        </header>
        <div class="pedido-modal-body">
          <div class="opt-block">
            <p class="tabla-hint">Elige tu envoltura</p>
            <div class="shawarma-ings">
              ${envOpts
                .map(
                  (e) => `
                <button type="button" class="salsa-chip ${
                  cfg.envoltura === e.env ? "is-on" : ""
                }" data-roll-env="${escapeHtml(e.env)}" aria-pressed="${
                  cfg.envoltura === e.env
                }">${escapeHtml(e.env)} · ${money(e.precio)}</button>`
                )
                .join("")}
            </div>
          </div>
          <div class="opt-block">
            <p class="tabla-hint">Elige carne o vegetal</p>
            <div class="shawarma-ings">
              ${RELLENOS_ROLL.map(
                (r) => `
                <button type="button" class="salsa-chip ${
                  cfg.relleno === r ? "is-on" : ""
                }" data-roll-relleno="${escapeHtml(r)}" aria-pressed="${
                  cfg.relleno === r
                }">${escapeHtml(r)}</button>`
              ).join("")}
            </div>
          </div>
          <div class="opt-block">
            <p class="tabla-hint">Elige acompañamiento</p>
            <div class="shawarma-ings">
              <button type="button" class="salsa-chip ${
                cfg.acompanamientoTipo === "queso" ? "is-on" : ""
              }" data-roll-acomp="queso" aria-pressed="${
                cfg.acompanamientoTipo === "queso"
              }">${escapeHtml(ACOMP_QUESO)}</button>
              ${VEGETALES_ROLL.map(
                (v) => `
                <button type="button" class="salsa-chip ${
                  cfg.acompanamientoTipo === "vegetal" && cfg.vegetal === v
                    ? "is-on"
                    : ""
                }" data-roll-acomp="vegetal" data-roll-vegetal="${escapeHtml(
                  v
                )}" aria-pressed="${
                  cfg.acompanamientoTipo === "vegetal" && cfg.vegetal === v
                }">${escapeHtml(v)}</button>`
              ).join("")}
            </div>
          </div>
          ${
            topOpts.length
              ? `<div class="opt-block">
            <p class="tabla-hint">Agrega en topping</p>
            <div class="shawarma-ings">
              ${topOpts
                .map(
                  (t) => `
                <button type="button" class="salsa-chip ${
                  cfg.toppings[t.key] ? "is-on" : ""
                }" data-roll-topping="${escapeHtml(t.key)}" aria-pressed="${Boolean(
                  cfg.toppings[t.key]
                )}">${escapeHtml(t.label)} · +${money(t.precio)}</button>`
                )
                .join("")}
            </div>
          </div>`
              : ""
          }
          <div class="opt-block">
            <p class="tabla-hint">Salsas extras · ${money(PRECIO_SALSA_EXTRA_ROLL)} c/u</p>
            <div class="shawarma-ings">
              ${SALSAS_ROLL.map(
                (s) => `
                <button type="button" class="salsa-chip ${
                  cfg.salsas[s] ? "is-on" : ""
                }" data-roll-salsa="${escapeHtml(s)}" aria-pressed="${Boolean(
                  cfg.salsas[s]
                )}">${escapeHtml(s)}</button>`
              ).join("")}
            </div>
          </div>
          <label class="add-qty-label" for="roll-cantidad">Cantidad</label>
          <div class="add-qty-row">
            <div class="add-qty">
              <button type="button" id="btn-roll-dec" aria-label="Menos">−</button>
              <input id="roll-cantidad" type="number" min="1" step="1" value="${cant}" />
              <button type="button" id="btn-roll-inc" aria-label="Más">+</button>
            </div>
            <button type="button" class="btn btn-add" id="btn-roll-confirmar" ${
              completa ? "" : "disabled"
            }>Agregar</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function abrirGohanModal() {
  const p = productoGohan(state.productos);
  if (!p) {
    toast("Falta el producto Gohan. Ejecuta seed_menu.", true);
    return;
  }
  state.gohanConfig = { ...emptyGohanConfig(), producto: p };
  state.tablaConfig = null;
  state.shawarmaConfig = null;
  state.rollConfig = null;
  state.confirmSalsa = null;
  state.addModal = null;
  state.cartOpen = false;
  render();
}

function cerrarGohanModal() {
  state.gohanConfig = null;
  render();
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
  const precioEl = document.getElementById("gohan-precio");
  if (precioEl) {
    precioEl.textContent = precioModalHeader(
      unit,
      cfg.furay ? ` · incluye furay ${money(precioFuray)}` : ""
    );
  }
  const input = document.getElementById("gohan-cantidad");
  if (input) input.value = String(cant);
  document.querySelectorAll("[data-gohan-espol]").forEach((btn) => {
    const on = btn.dataset.gohanEspol === cfg.espolvoreado;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll("[data-gohan-proteina]").forEach((btn) => {
    const on = btn.dataset.gohanProteina === cfg.proteina;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  const furayBtn = document.getElementById("btn-gohan-furay");
  if (furayBtn) {
    furayBtn.classList.toggle("is-on", Boolean(cfg.furay));
    furayBtn.setAttribute("aria-pressed", String(Boolean(cfg.furay)));
  }
  document.querySelectorAll("[data-gohan-veg]").forEach((btn) => {
    const on = (cfg.vegetales || []).includes(btn.dataset.gohanVeg);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  const vegCount = (cfg.vegetales || []).length;
  const vegHint = document.getElementById("gohan-veg-hint");
  if (vegHint) vegHint.textContent = vegCount ? ` · ${vegCount}/2` : "";
  if (!cfg.vegError) clearGohanVegError();
  const confirm = document.getElementById("btn-gohan-confirmar");
  if (confirm) confirm.disabled = !gohanConfigCompleta(cfg);
}

function showGohanVegError(msg) {
  if (state.gohanConfig) state.gohanConfig.vegError = msg;
  const err = document.getElementById("gohan-veg-error");
  if (err) {
    err.hidden = false;
    err.textContent = msg;
  }
}

function clearGohanVegError() {
  if (state.gohanConfig) state.gohanConfig.vegError = null;
  const err = document.getElementById("gohan-veg-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
}

function renderGohanModal() {
  const cfg = state.gohanConfig;
  if (!cfg) return "";
  const { unit, cant, precioFuray, furay } = gohanModalSnapshot(cfg);
  const completa = gohanConfigCompleta(cfg);
  const vegCount = (cfg.vegetales || []).length;
  return `
    <div class="pedido-overlay" id="gohan-overlay" role="dialog" aria-modal="true">
      <div class="pedido-modal tabla-modal">
        <header class="pedido-modal-head">
          <div>
            <p class="pedido-kicker">Arma tu Gohan</p>
            <h2>Personalizar gohan</h2>
            <p class="tabla-precio" id="gohan-precio">${precioModalHeader(
              unit,
              cfg.furay ? ` · incluye furay ${money(precioFuray)}` : ""
            )}</p>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-gohan" aria-label="Cerrar">×</button>
        </header>
        <div class="pedido-modal-body">
          <p class="tabla-hint">Incluye arroz, queso phila, salsa y espolvoreado</p>
          <div class="opt-block">
            <p class="tabla-hint">Elige tu espolvoreado</p>
            <div class="shawarma-ings">
              ${ESPOLVOREADOS_GOHAN.map(
                (e) => `
                <button type="button" class="salsa-chip ${
                  cfg.espolvoreado === e ? "is-on" : ""
                }" data-gohan-espol="${escapeHtml(e)}" aria-pressed="${
                  cfg.espolvoreado === e
                }">${escapeHtml(e)}</button>`
              ).join("")}
            </div>
          </div>
          <div class="opt-block">
            <p class="tabla-hint">Elige proteína o vegetal</p>
            <div class="shawarma-ings">
              ${PROTEINAS_GOHAN.map(
                (r) => `
                <button type="button" class="salsa-chip ${
                  cfg.proteina === r ? "is-on" : ""
                }" data-gohan-proteina="${escapeHtml(r)}" aria-pressed="${
                  cfg.proteina === r
                }">${escapeHtml(r)}</button>`
              ).join("")}
            </div>
            ${
              furay
                ? `<div class="shawarma-ings" style="margin-top:8px">
                <button type="button" class="salsa-chip ${
                  cfg.furay ? "is-on" : ""
                }" id="btn-gohan-furay" aria-pressed="${Boolean(cfg.furay)}">
                  Furay · +${money(precioFuray)}
                </button>
              </div>`
                : ""
            }
          </div>
          <div class="opt-block">
            <p class="tabla-hint" id="gohan-veg-label">Elige 2 vegetales<span id="gohan-veg-hint">${
              vegCount ? ` · ${vegCount}/2` : ""
            }</span></p>
            <p class="tabla-hint is-error" id="gohan-veg-error" ${
              cfg.vegError ? "" : "hidden"
            }>${cfg.vegError ? escapeHtml(cfg.vegError) : ""}</p>
            <div class="shawarma-ings">
              ${VEGETALES_GOHAN.map(
                (v) => `
                <button type="button" class="salsa-chip ${
                  (cfg.vegetales || []).includes(v) ? "is-on" : ""
                }" data-gohan-veg="${escapeHtml(v)}" aria-pressed="${
                  (cfg.vegetales || []).includes(v)
                }">${escapeHtml(v)}</button>`
              ).join("")}
            </div>
          </div>
          <label class="add-qty-label" for="gohan-cantidad">Cantidad</label>
          <div class="add-qty-row">
            <div class="add-qty">
              <button type="button" id="btn-gohan-dec" aria-label="Menos">−</button>
              <input id="gohan-cantidad" type="number" min="1" step="1" value="${cant}" />
              <button type="button" id="btn-gohan-inc" aria-label="Más">+</button>
            </div>
            <button type="button" class="btn btn-add" id="btn-gohan-confirmar" ${
              completa ? "" : "disabled"
            }>Agregar</button>
          </div>
        </div>
      </div>
    </div>
  `;
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
            <p class="tabla-precio" id="shawarma-precio">${precioModalHeader(
              unit,
              extras ? ` · incluye ${extras} salsa(s) extra` : ""
            )}</p>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-shawarma" aria-label="Cerrar">×</button>
        </header>
        <div class="pedido-modal-body">
          <div class="opt-block">
            <p class="tabla-hint"><strong>Masa</strong> (elige una)</p>
            <div class="opt-row-plain">
              ${MASAS_SHAWARMA.map(
                (m, i) => `
                ${i ? `<span class="opt-sep" aria-hidden="true">·</span>` : ""}
                <button type="button" class="opt-plain opt-choice ${
                  (cfg.masa || MASA_DEFAULT) === m.id ? "is-on" : ""
                }" data-masa="${escapeHtml(m.id)}" role="checkbox" aria-checked="${
                  (cfg.masa || MASA_DEFAULT) === m.id ? "true" : "false"
                }">
                  <span class="opt-box" aria-hidden="true">${
                    (cfg.masa || MASA_DEFAULT) === m.id ? "✓" : ""
                  }</span>
                  ${escapeHtml(m.label)}${
                    m.detalle
                      ? ` <span class="tabla-hint" style="display:inline;margin:0">(${escapeHtml(
                          m.detalle
                        )})</span>`
                      : ""
                  }
                </button>`
              ).join("")}
            </div>
          </div>
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
  const salsas = salsasSeleccionadasRoll(cfg.salsas);
  const unit =
    Number(p.precio) + salsas.length * PRECIO_SALSA_EXTRA_ROLL;

  return `
    <div class="pedido-overlay" id="tabla-overlay" role="dialog" aria-modal="true">
      <div class="pedido-modal tabla-modal">
        <header class="pedido-modal-head">
          <div>
            <p class="pedido-kicker">Personalizar tabla</p>
            <h2>${escapeHtml(p.nombre)}</h2>
            <p class="tabla-precio" id="tabla-precio">${precioModalHeader(
              unit,
              salsas.length ? ` · ${salsas.length} salsa(s)` : ""
            )}</p>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-tabla" aria-label="Cerrar">×</button>
        </header>
        <div class="pedido-modal-body">
          <p class="tabla-hint">Ingredientes · toca <span class="hint-x">×</span> o <span class="hint-plus">+</span></p>
          <ul class="tabla-rolls-list">
            ${renderTablaRollsList(cfg.rolls)}
          </ul>
          <div class="opt-block" style="margin-top:16px">
            <p class="tabla-hint">Salsas · ${money(PRECIO_SALSA_EXTRA_ROLL)} c/u</p>
            <div class="shawarma-ings">
              ${SALSAS_ROLL.map(
                (s) => `
                <button type="button" class="salsa-chip ${
                  cfg.salsas?.[s] ? "is-on" : ""
                }" data-tabla-salsa="${escapeHtml(s)}" aria-pressed="${Boolean(
                  cfg.salsas?.[s]
                )}">${escapeHtml(s)}</button>`
              ).join("")}
            </div>
          </div>
        </div>
        <footer class="pedido-modal-foot">
          <button type="button" class="btn btn-ghost" id="btn-tabla-todos">Restablecer ingredientes</button>
          <button type="button" class="btn btn-add" id="btn-tabla-confirmar">
            Agregar · ${money(unit)}
          </button>
        </footer>
      </div>
    </div>
  `;
}

function syncTablaSalsaUI() {
  const cfg = state.tablaConfig;
  if (!cfg) return;
  const salsas = salsasSeleccionadasRoll(cfg.salsas);
  const unit = Number(cfg.producto.precio) + salsas.length * PRECIO_SALSA_EXTRA_ROLL;
  const precioEl = document.getElementById("tabla-precio");
  if (precioEl) {
    precioEl.textContent = precioModalHeader(
      unit,
      salsas.length ? ` · ${salsas.length} salsa(s)` : ""
    );
  }
  document.querySelectorAll("[data-tabla-salsa]").forEach((btn) => {
    const on = Boolean(cfg.salsas?.[btn.dataset.tablaSalsa]);
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  const confirm = document.getElementById("btn-tabla-confirmar");
  if (confirm) confirm.textContent = `Agregar · ${money(unit)}`;
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
  const activos = productosParaCarta();
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
                <div class="cat">${escapeHtml(esGohan(p) ? "Arma tu Gohan" : p.categoria)}</div>
                <h3>${escapeHtml(esGohan(p) ? "Arma tu Gohan" : p.nombre)}</h3>
                ${p.descripcion ? `<p class="desc">${escapeHtml(p.descripcion)}</p>` : ""}
              </div>
              <div class="product-foot">
                <span class="price-tag">${p._virtualRoll ? `Desde ${money(p.precio)}` : money(p.precio)}</span>
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
    ${renderRollModal()}
    ${renderGohanModal()}
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
          <button type="button" class="modal-x" id="btn-cerrar-postcobro" aria-label="Cerrar" onclick="state.postCobro = null; document.getElementById('postcobro-overlay').remove();">&times;</button>
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
        <p><strong>${escapeHtml(p.cliente_nombre)}</strong> · ${escapeHtml(p.telefono)}</p>
        <p class="sub">
          ${escapeHtml(p.tipo_entrega)}${
            p.zona_nombre
              ? ` · ${escapeHtml(p.zona_nombre)}${Number(p.cobro_delivery) ? ` ${money(p.cobro_delivery)}` : ""}`
              : ""
          }${
            p.direccion ? ` · ${escapeHtml(p.direccion)}` : ""
          } · ${p.metodo_pago === "tienda" ? "Pagar en tienda" : "Pagado Webpay"}
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
      <p class="sub">Pedidos pagados con Webpay y pedidos para pagar en tienda. Imprime la comanda y márcalo recibido.</p>
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
    `Cliente: ${p.cliente_nombre}`,
    `Tel: ${p.telefono}`,
  ];
  if (p.tipo_entrega === "delivery" && p.zona_nombre) {
    const cobertura = p.zona_descripcion ? ` (${p.zona_descripcion})` : "";
    notaParts.push(`Zona: ${p.zona_nombre}${cobertura}`);
  }
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
  const isAdmin = state.user?.rol === "administrador";

  const rows = state.inventario
    .map(
      (i) => `
        <tr>
          <td>
            ${
              isAdmin
                ? `<input
                    type="text"
                    id="nombre-inv-${i.id}"
                    value="${escapeHtml(i.nombre || "")}"
                    style="min-width:180px"
                  />`
                : escapeHtml(i.nombre || "—")
            }
          </td>

          <td>
            ${
              isAdmin
                ? `<input
                    type="number"
                    id="cantidad-inv-${i.id}"
                    value="${Number(i.cantidad) || 0}"
                    min="0"
                    step="1"
                    style="width:110px"
                  />`
                : `${Number(i.cantidad) || 0} unidades`
            }
          </td>

          <td>
            ${
              isAdmin
                ? `<input
                    type="text"
                    id="notas-inv-${i.id}"
                    value="${escapeHtml(i.notas || "")}"
                    placeholder="Notas opcionales"
                  />`
                : escapeHtml(i.notas || "—")
            }
          </td>

          <td>
            ${
              isAdmin
                ? `
                  <div class="row-actions">
                    <button
                      class="btn btn-mint"
                      data-guardar-inv="${i.id}"
                      type="button"
                      style="width:auto"
                    >
                      Guardar
                    </button>

                    <button
                      class="btn btn-danger"
                      data-quitar-inv="${i.id}"
                      type="button"
                      style="width:auto"
                    >
                      Quitar
                    </button>
                  </div>
                `
                : "—"
            }
          </td>
        </tr>
      `
    )
    .join("");

  return `
    <section class="panel">
      <h2>Inventario de empaques</h2>

      <p class="sub">
        Registro manual de empaques y unidades disponibles.
      </p>

      ${
        isAdmin
          ? `
            <form
              id="form-agregar-inv"
              class="row-actions"
              style="align-items:end"
            >
              <div class="field" style="margin:0;flex:1;min-width:200px">
                <label for="nombre-inv">Empaque</label>
                <input
                  id="nombre-inv"
                  type="text"
                  placeholder="Ej. Caja sushi C-10"
                  required
                />
              </div>

              <div class="field" style="margin:0;min-width:150px">
                <label for="cantidad-inv">Unidades</label>
                <input
                  id="cantidad-inv"
                  type="number"
                  min="0"
                  step="1"
                  value="0"
                  required
                />
              </div>

              <div class="field" style="margin:0;flex:1;min-width:180px">
                <label for="notas-inv">Notas (opcional)</label>
                <input
                  id="notas-inv"
                  type="text"
                  placeholder="Ej. proveedor, ubicación…"
                />
              </div>

              <button
                class="btn btn-primary"
                type="submit"
                style="width:auto"
              >
                Agregar
              </button>
            </form>
          `
          : ""
      }

      <div style="overflow:auto;margin-top:16px">
        <table class="table">
          <thead>
            <tr>
              <th>Empaque</th>
              <th>Unidades</th>
              <th>Notas</th>
              <th>Acciones</th>
            </tr>
          </thead>

          <tbody>
            ${
              rows ||
              `
                <tr>
                  <td colspan="4" class="muted">
                    Inventario de empaques vacío.
                  </td>
                </tr>
              `
            }
          </tbody>
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
          <td style="text-align:center">${p.cantidad}</td>
          <td style="text-align:right"><strong>${money(p.monto)}</strong></td>
        </tr>`
    )
    .join("");

  return `
    <section class="panel">

      <!-- ENCABEZADO -->
      <div style="
        display:flex;
        justify-content:space-between;
        align-items:flex-end;
        gap:16px;
        flex-wrap:wrap;
        margin-bottom:18px;
      ">
        <div>
          <h2 style="margin-bottom:4px">Reporte diario</h2>
          <p class="sub" style="margin:0">
            Resumen de ventas y movimientos de la jornada.
          </p>
        </div>

        <div class="row-actions" style="align-items:end;margin:0">
          <div class="field" style="margin:0">
            <label for="reporte-fecha">Fecha</label>
            <input
              id="reporte-fecha"
              type="date"
              value="${escapeHtml(state.reporteFecha)}"
            />
          </div>

          <button
            class="btn btn-ghost"
            id="btn-print-reporte"
            type="button"
            style="width:auto"
            ${r ? "" : "disabled"}
          >
            Imprimir
          </button>
        </div>
      </div>

      ${
        r
          ? `
            <!-- FECHA DEL REPORTE -->
            <div style="
              display:flex;
              align-items:center;
              justify-content:space-between;
              margin-bottom:10px;
            ">
              <h3 class="section-title" style="margin:0">
                Resumen del día
              </h3>

              <span class="muted" style="font-size:.9rem">
                ${escapeHtml(formatFecha(r.fecha))}
              </span>
            </div>

            <!-- RESUMEN PRINCIPAL -->
            <div
              class="stats"
              style="
                grid-template-columns:repeat(3, minmax(130px, 1fr));
                margin-bottom:18px;
              "
            >
              <div class="stat">
                <div class="label">Ventas</div>
                <div class="value">${r.cantidad_ventas}</div>
              </div>

              <div class="stat">
                <div class="label">Anuladas</div>
                <div class="value">${r.cantidad_anuladas}</div>
              </div>

              <div class="stat">
                <div class="label">Total del día</div>
                <div class="value">${money(r.total_general)}</div>
              </div>
            </div>

            <!-- MEDIOS DE PAGO -->
            <h3 class="section-title" style="margin:0 0 8px">
              Medios de pago
            </h3>

            <div
              style="
                display:grid;
                grid-template-columns:repeat(5, minmax(100px, 1fr));
                gap:8px;
                margin-bottom:18px;
              "
            >
              <div class="stat" style="padding:10px 12px">
                <div class="label">Efectivo</div>
                <div class="value" style="font-size:1.05rem">
                  ${money(r.total_efectivo)}
                </div>
              </div>

              <div class="stat" style="padding:10px 12px">
                <div class="label">Débito</div>
                <div class="value" style="font-size:1.05rem">
                  ${money(r.total_debito)}
                </div>
              </div>

              <div class="stat" style="padding:10px 12px">
                <div class="label">Crédito</div>
                <div class="value" style="font-size:1.05rem">
                  ${money(r.total_credito)}
                </div>
              </div>

              <div class="stat" style="padding:10px 12px">
                <div class="label">Transferencia</div>
                <div class="value" style="font-size:1.05rem">
                  ${money(r.total_transferencias)}
                </div>
              </div>

              <div class="stat" style="padding:10px 12px">
                <div class="label">Webpay</div>
                <div class="value" style="font-size:1.05rem">
                  ${money(r.total_webpay)}
                </div>
              </div>
            </div>

            <!-- ENTREGAS -->
            <div
              style="
                display:flex;
                align-items:center;
                gap:22px;
                flex-wrap:wrap;
                padding:10px 14px;
                margin-bottom:20px;
                border:1px solid var(--border);
                border-radius:10px;
              "
            >
              <strong style="font-size:.9rem">Entregas</strong>

              <span class="muted">
                Retiro:
                <strong style="color:var(--text)">
                  ${r.por_entrega?.retiro ?? 0}
                </strong>
              </span>

              <span class="muted">
                Delivery:
                <strong style="color:var(--text)">
                  ${r.por_entrega?.delivery ?? 0}
                </strong>
              </span>
            </div>

            <!-- PRODUCTOS -->
            <h3 class="section-title" style="margin:0 0 8px">
              Detalle de productos vendidos
            </h3>

            <div style="overflow:auto">
              <table class="table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th style="text-align:center">Cantidad</th>
                    <th style="text-align:right">Monto</th>
                  </tr>
                </thead>

                <tbody>
                  ${
                    productos ||
                    `
                      <tr>
                        <td colspan="3" class="muted">
                          Sin ventas ese día.
                        </td>
                      </tr>
                    `
                  }
                </tbody>
              </table>
            </div>
          `
          : `
            <p class="muted" style="margin-top:16px">
              Elige una fecha y toca Ver reporte.
            </p>
          `
      }
    </section>
  `;
}

function cerrarZonaModal() {
  state.zonaModalOpen = false;
  state.zonaForm = emptyZonaForm();
}

function renderZonaModal() {
  if (!state.zonaModalOpen) return "";
  const f = state.zonaForm || emptyZonaForm();
  const editando = Boolean(f.id);
  return `
    <div class="pedido-overlay zona-overlay" id="zona-overlay" role="dialog" aria-modal="true" aria-labelledby="zona-modal-title">
      <div class="pedido-modal" style="max-width:440px">
        <header class="pedido-modal-head">
          <div>
            <p class="pedido-kicker">Delivery</p>
            <h2 id="zona-modal-title">${editando ? "Editar zona" : "Agregar zona"}</h2>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-zona" aria-label="Cerrar">×</button>
        </header>
        <form id="form-zona">
          <div class="pedido-modal-body">
            <div class="field">
              <label for="zona-nombre">Nombre</label>
              <input id="zona-nombre" required maxlength="80" value="${escapeHtml(f.nombre)}" placeholder="Ciudad" />
            </div>
            <div class="field">
              <label for="zona-descripcion">Cobertura</label>
              <input id="zona-descripcion" maxlength="200" value="${escapeHtml(f.descripcion)}" placeholder="Desde Tres Puentes a Barranco Amarillo" />
            </div>
            <div class="field">
              <label for="zona-precio">Precio (CLP)</label>
              <input id="zona-precio" type="number" min="0" step="1" inputmode="numeric" required value="${escapeHtml(
                precioInputClp(f.precio)
              )}" placeholder="3500" />
            </div>
          </div>
          <footer class="pedido-modal-foot row-actions" style="margin:0">
            <button class="btn btn-primary" type="submit" style="width:auto">${editando ? "Guardar cambios" : "Agregar"}</button>
            <button class="btn btn-ghost" type="button" id="btn-cancelar-zona" style="width:auto">Cancelar</button>
          </footer>
        </form>
      </div>
    </div>
  `;
}

function hhmm(t) {
  if (!t) return "";
  const s = String(t);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function emptyHorarioForm() {
  return {
    habilitado: true,
    lunes: true,
    martes: true,
    miercoles: true,
    jueves: true,
    viernes: true,
    sabado: true,
    domingo: false,
    turno1_activo: true,
    turno1_inicio: "12:00",
    turno1_fin: "15:45",
    turno2_activo: true,
    turno2_inicio: "18:00",
    turno2_fin: "22:45",
    texto_horario: "Lunes a sábado: 12:00–15:45 y 18:00–22:45",
    mensaje_cerrado:
      "Ahora no recibimos pedidos online. Horario: lunes a sábado de 12:00 a 15:45 y de 18:00 a 22:45.",
  };
}

function horarioFormFromApi(data) {
  const base = emptyHorarioForm();
  if (!data) return base;
  return {
    ...base,
    ...data,
    turno1_inicio: hhmm(data.turno1_inicio) || base.turno1_inicio,
    turno1_fin: hhmm(data.turno1_fin) || base.turno1_fin,
    turno2_inicio: hhmm(data.turno2_inicio) || base.turno2_inicio,
    turno2_fin: hhmm(data.turno2_fin) || base.turno2_fin,
  };
}

async function loadHorario() {
  state.horarioError = "";
  state.horarioLoaded = false;
  try {
    state.horarioForm = horarioFormFromApi(await api.horarioPedidosConfig());
    state.horarioLoaded = true;
  } catch (e) {
    state.horarioForm = null;
    state.horarioLoaded = false;
    state.horarioError = e.message || "No se pudo cargar el horario";
  }
}

function renderHorario() {
  const f = state.horarioForm || emptyHorarioForm();
  const puedeEditar = Boolean(state.horarioLoaded && state.horarioForm);
  const dias = [
    ["lunes", "Lun"],
    ["martes", "Mar"],
    ["miercoles", "Mié"],
    ["jueves", "Jue"],
    ["viernes", "Vie"],
    ["sabado", "Sáb"],
    ["domingo", "Dom"],
  ];
  const dis = puedeEditar ? "" : "disabled";
  return `
    <section class="panel">
      <h2>Horario pedidos web</h2>
      <p class="sub">Define cuándo la carta online acepta pedidos. La caja del local no se ve afectada.</p>
      ${
        state.horarioError
          ? `<p class="cart-error" role="alert">${escapeHtml(state.horarioError)}</p>
             <div class="row-actions" style="margin:0 0 12px">
               <button class="btn btn-mint" type="button" id="btn-reintentar-horario" style="width:auto">Reintentar carga</button>
             </div>`
          : ""
      }
      <form id="form-horario" class="horario-form">
        <label class="check-row">
          <input type="checkbox" name="habilitado" ${f.habilitado ? "checked" : ""} ${dis} />
          <span>Recibir pedidos online</span>
        </label>
        <p class="tabla-hint">Días abiertos</p>
        <div class="horario-dias" role="group" aria-label="Días abiertos">
          ${dias
            .map(
              ([key, label]) => `
            <div class="horario-dia-wrap">
              <button
                type="button"
                class="horario-dia ${f[key] ? "is-on" : ""}"
                data-dia="${key}"
                aria-pressed="${f[key] ? "true" : "false"}"
                ${dis}
              >${label}</button>
              <input type="checkbox" name="${key}" class="sr-only" tabindex="-1" ${
                f[key] ? "checked" : ""
              } ${dis} />
            </div>`
            )
            .join("")}
        </div>
        <div class="horario-turnos">
          <fieldset>
            <legend>
              <label class="check-row" style="margin:0">
                <input type="checkbox" name="turno1_activo" ${f.turno1_activo !== false ? "checked" : ""} ${dis} />
                <span>Turno 1</span>
              </label>
            </legend>
            <div class="horario-times">
              <label>Desde <input type="time" name="turno1_inicio" value="${escapeHtml(
                f.turno1_inicio
              )}" ${f.turno1_activo !== false && puedeEditar ? "required" : "disabled"} /></label>
              <label>Hasta <input type="time" name="turno1_fin" value="${escapeHtml(
                f.turno1_fin
              )}" ${f.turno1_activo !== false && puedeEditar ? "required" : "disabled"} /></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>
              <label class="check-row" style="margin:0">
                <input type="checkbox" name="turno2_activo" ${f.turno2_activo ? "checked" : ""} ${dis} />
                <span>Turno 2</span>
              </label>
            </legend>
            <div class="horario-times">
              <label>Desde <input type="time" name="turno2_inicio" value="${escapeHtml(
                f.turno2_inicio
              )}" ${f.turno2_activo && puedeEditar ? "required" : "disabled"} /></label>
              <label>Hasta <input type="time" name="turno2_fin" value="${escapeHtml(
                f.turno2_fin
              )}" ${f.turno2_activo && puedeEditar ? "required" : "disabled"} /></label>
            </div>
          </fieldset>
        </div>
        <label class="field">
          <span>Texto de horario (carta)</span>
          <input type="text" name="texto_horario" maxlength="200" value="${escapeHtml(
            f.texto_horario
          )}" required ${dis} />
        </label>
        <label class="field">
          <span>Mensaje cuando está cerrado</span>
          <textarea name="mensaje_cerrado" rows="3" required ${dis}>${escapeHtml(
            f.mensaje_cerrado
          )}</textarea>
        </label>
        <div class="row-actions">
          <button class="btn btn-primary" type="submit" id="btn-guardar-horario" ${
            state.horarioSaving || !puedeEditar ? "disabled" : ""
          } style="width:auto">
            ${
              state.horarioSaving
                ? "Guardando…"
                : !puedeEditar
                  ? "Carga el horario para editar"
                  : "Guardar horario"
            }
          </button>
        </div>
      </form>
    </section>
  `;
}

function renderDelivery() {
  const rows = (state.zonas || [])
    .map(
      (z) => `
      <tr>
        <td>${escapeHtml(z.nombre)}</td>
        <td>${escapeHtml(z.descripcion || "—")}</td>
        <td>${money(z.precio)}</td>
        <td class="zona-actions">
          <div class="kebab">
            <button class="kebab-btn" type="button" data-zona-menu aria-label="Opciones de ${escapeHtml(z.nombre)}" aria-expanded="false" aria-haspopup="menu">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
            </button>
            <div class="kebab-menu" role="menu" hidden>
              <button type="button" role="menuitem" data-editar-zona="${z.id}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"/></svg>
                Editar
              </button>
              <button type="button" role="menuitem" class="is-danger" data-eliminar-zona="${z.id}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M8 7l1 13h6l1-13"/></svg>
                Eliminar
              </button>
            </div>
          </div>
        </td>
      </tr>`
    )
    .join("");

  return `
    <section class="panel">
      <h2>Delivery</h2>
      <p class="sub">Tarifas que se cobran en el POS y en los pedidos web. Ciudad y rural se pueden cambiar cuando quieras.</p>
      ${
        state.zonasError
          ? `<p class="cart-error" role="alert">${escapeHtml(state.zonasError)}</p>`
          : ""
      }
      <div class="row-actions" style="margin-top:0">
        <button class="btn btn-primary" type="button" id="btn-agregar-zona" style="width:auto">Agregar</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Zona</th><th>Cobertura</th><th>Precio</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="muted">${state.zonasError ? "No se pudieron mostrar las zonas." : "Todavía no hay zonas. Agrega la primera."}</td></tr>`}</tbody>
        </table>
      </div>
    </section>
    ${renderZonaModal()}
  `;
}

function renderCaja() {
  const p = state.cajaPreview;
  const cierre = state.cajaCerrada;
  const movimientos = cierre?.movimientos || [];

  const nombreMetodo = (metodo) => {
    const nombres = {
      efectivo: "Efectivo",
      debito: "Débito",
      credito: "Crédito",
      transferencia: "Transferencia",
      webpay: "Webpay",
      tarjeta: "Tarjeta",
    };

    return nombres[metodo] || metodo;
  };

  const detalleMovimientos = movimientos
    .map((mov) => {
      const pagos = (mov.pagos || [])
        .map(
          (pago) =>
            `${nombreMetodo(pago.metodo)} ${money(pago.monto)}`
        )
        .join(" + ");

      const hora = mov.fecha_hora
        ? new Date(mov.fecha_hora).toLocaleTimeString("es-CL", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—";

      return `
        <tr>
          <td><strong>#${escapeHtml(mov.venta_id)}</strong></td>
          <td>${escapeHtml(hora)}</td>
          <td>${escapeHtml(mov.cajero || "—")}</td>
          <td>${escapeHtml(pagos || "—")}</td>
          <td style="text-align:right">
            <strong>${money(mov.total)}</strong>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <section class="panel">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
        <div>
          <h2>${cierre ? "Cierre de caja" : "Cierre de caja"}</h2>
          <p class="sub">
            ${
              cierre
                ? `Resumen final correspondiente al ${escapeHtml(formatFecha(cierre.fecha))}.`
                : "Totales calculados desde ventas completadas del día."
            }
          </p>
        </div>

        ${
          cierre
            ? `
              <div style="
                padding:8px 16px;
                border:2px solid var(--navy);
                border-radius:999px;
                font-weight:800;
              ">
                CAJA CERRADA
              </div>
            `
            : ""
        }
      </div>

      ${
        p
          ? `
            <div class="stats">
              <div class="stat">
                <div class="label">Fecha</div>
                <div class="value" style="font-size:1rem;color:var(--text)">
                  ${escapeHtml(formatFecha(p.fecha))}
                </div>
              </div>

              <div class="stat">
                <div class="label">Efectivo</div>
                <div class="value">${money(p.total_efectivo)}</div>
              </div>

              <div class="stat">
                <div class="label">Débito</div>
                <div class="value">${money(p.total_debito)}</div>
              </div>

              <div class="stat">
                <div class="label">Crédito</div>
                <div class="value">${money(p.total_credito)}</div>
              </div>

              <div class="stat">
                <div class="label">Transferencias</div>
                <div class="value">${money(p.total_transferencias)}</div>
              </div>

              <div class="stat">
                <div class="label">Webpay</div>
                <div class="value">${money(p.total_webpay)}</div>
              </div>

              <div class="stat">
                <div class="label">Total</div>
                <div class="value">${money(p.total_general)}</div>
              </div>

              <div class="stat">
                <div class="label">Ventas</div>
                <div class="value">${p.cantidad_ventas}</div>
              </div>
            </div>
          `
          : `<p class="muted">Cargando preview…</p>`
      }

      ${
        cierre
          ? `
            <div style="margin-top:28px">
              <h3 class="section-title">Detalle de movimientos</h3>

              <div style="overflow:auto">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Venta</th>
                      <th>Hora</th>
                      <th>Cajero</th>
                      <th>Forma de pago</th>
                      <th style="text-align:right">Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${
                      detalleMovimientos ||
                      `
                        <tr>
                          <td colspan="5" class="muted">
                            No hubo movimientos durante el día.
                          </td>
                        </tr>
                      `
                    }
                  </tbody>
                </table>
              </div>

              <div class="row-actions">
                <button
                  class="btn btn-primary"
                  id="btn-imprimir-cierre"
                  type="button"
                  style="width:auto"
                >
                  Imprimir cierre
                </button>
              </div>
            </div>
          `
          : `
            <div class="row-actions">
              <button
                class="btn btn-mint"
                id="btn-preview-caja"
                type="button"
              >
                Actualizar 
              </button>

              <button
                class="btn btn-primary"
                id="btn-cerrar-caja"
                type="button"
                style="width:auto"
              >
                Cerrar caja de hoy
              </button>
            </div>
          `
      }
    </section>
  `;
}

function cerrarProductoModal() {
  state.productoModalOpen = false;
  state.productoForm = emptyProductoForm();
}

function renderProductoModal() {
  if (!state.productoModalOpen) return "";
  const f = state.productoForm || emptyProductoForm();
  const editando = Boolean(f.id);
  return `
    <div class="pedido-overlay" id="producto-overlay" role="dialog" aria-modal="true">
      <div class="pedido-modal" style="max-width:480px">
        <header class="pedido-modal-head">
          <div>
            <p class="pedido-kicker">Carta</p>
            <h2>${editando ? "Editar producto" : "Agregar producto"}</h2>
          </div>
          <button type="button" class="modal-x" id="btn-cerrar-producto" aria-label="Cerrar">×</button>
        </header>
        <form id="form-producto">
          <div class="pedido-modal-body">
            <div class="field">
              <label for="prod-nombre">Nombre</label>
              <input id="prod-nombre" required maxlength="150" value="${escapeHtml(f.nombre)}" placeholder="Ej. Gyozas (5u)" />
            </div>
            <div class="field">
              <label for="prod-descripcion">Descripción</label>
              <textarea id="prod-descripcion" rows="2" maxlength="500" placeholder="Opcional">${escapeHtml(
                f.descripcion || ""
              )}</textarea>
            </div>
            <div class="horario-times" style="margin-bottom:14px">
              <div class="field" style="margin:0">
                <label for="prod-precio">Precio (CLP)</label>
                <input id="prod-precio" type="number" min="1" step="1" inputmode="numeric" required value="${escapeHtml(
                  precioInputClp(f.precio)
                )}" placeholder="5000" />
              </div>
              <div class="field" style="margin:0">
                <label for="prod-categoria">Categoría</label>
                <select id="prod-categoria" required>
                  ${CATEGORIAS_PRODUCTO.map(
                    ([id, label]) =>
                      `<option value="${id}" ${f.categoria === id ? "selected" : ""}>${escapeHtml(
                        label
                      )}</option>`
                  ).join("")}
                </select>
              </div>
            </div>
            <div class="field">
              <span class="field-label">Visibilidad</span>
              <label class="prod-visible-box" for="prod-visible">
                <input
                  id="prod-visible"
                  type="checkbox"
                  ${f.estado !== "inactivo" ? "checked" : ""}
                />
                <span>Visible en carta</span>
              </label>
            </div>
          </div>
          <footer class="pedido-modal-foot row-actions" style="margin:0">
            <button class="btn btn-primary" type="submit" style="width:auto">${
              editando ? "Guardar cambios" : "Agregar"
            }</button>
            <button class="btn btn-ghost" type="button" id="btn-cancelar-producto" style="width:auto">Cancelar</button>
          </footer>
        </form>
      </div>
    </div>
  `;
}

function productosCartaAdmin() {
  const q = state.cartaBusqueda.trim().toLowerCase();
  return (state.productos || [])
    .filter((p) => {
      if (state.cartaFiltro !== "todas" && p.categoria !== state.cartaFiltro) return false;
      if (!q) return true;
      return (
        String(p.nombre || "").toLowerCase().includes(q) ||
        String(p.descripcion || "").toLowerCase().includes(q)
      );
    })
    .slice()
    .sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === "activo" ? -1 : 1;
      return String(a.nombre).localeCompare(String(b.nombre), "es");
    });
}

function renderCartaAdmin() {
  const lista = productosCartaAdmin();
  const rows = lista
    .map(
      (p) => `
      <tr class="${p.estado !== "activo" ? "is-muted-row" : ""}">
        <td>${escapeHtml(p.nombre)}</td>
        <td>${escapeHtml(labelCategoria(p.categoria))}</td>
        <td>${money(p.precio)}</td>
        <td class="carta-estado-cell" title="${
          p.estado === "activo" ? "Visible" : "Oculto"
        }">
          <span class="carta-estado-mark ${
            p.estado === "activo" ? "is-on" : "is-off"
          }" aria-label="${p.estado === "activo" ? "Visible" : "Oculto"}">${
            p.estado === "activo" ? "✓" : "×"
          }</span>
        </td>
        <td class="zona-actions">
          <div class="kebab">
            <button class="kebab-btn" type="button" data-prod-menu aria-label="Opciones de ${escapeHtml(
              p.nombre
            )}" aria-expanded="false" aria-haspopup="menu">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
            </button>
            <div class="kebab-menu" role="menu" hidden>
              <button type="button" role="menuitem" data-editar-prod="${p.id}">
                Editar
              </button>
            </div>
          </div>
        </td>
      </tr>`
    )
    .join("");

  return `
    <section class="panel">
      <h2>Carta</h2>
      <p class="sub">Agrega, edita o desactiva productos. Lo inactivo no aparece en la caja ni en pedidos web.</p>
      <div class="row-actions" style="margin-top:0;align-items:end;flex-wrap:wrap">
        <div class="field" style="margin:0;min-width:180px">
          <label for="carta-filtro">Categoría</label>
          <select id="carta-filtro">
            ${CATEGORIAS.map(
              ([id, label]) =>
                `<option value="${id}" ${state.cartaFiltro === id ? "selected" : ""}>${escapeHtml(
                  label
                )}</option>`
            ).join("")}
          </select>
        </div>
        <div class="field" style="margin:0;flex:1;min-width:180px">
          <label for="carta-buscar">Buscar</label>
          <input id="carta-buscar" type="search" placeholder="Nombre…" value="${escapeHtml(
            state.cartaBusqueda
          )}" />
        </div>
        <button class="btn btn-primary" type="button" id="btn-agregar-producto" style="width:auto">Agregar</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Visible</th><th></th></tr></thead>
          <tbody>${
            rows ||
            `<tr><td colspan="5" class="muted">No hay productos con ese filtro.</td></tr>`
          }</tbody>
        </table>
      </div>
    </section>
    ${renderProductoModal()}
  `;
}

function render() {
  if (!state.user || !getTokens()) {
    if (state.authScreen === "register") renderRegister();
    else renderLogin();
    return;
  }

  let content = "";
  if (state.view === "pos") content = renderPos();
  if (state.view === "pedidos") content = renderPedidos();
  if (state.view === "ventas") content = renderVentas();
  if (state.view === "inventario") content = renderInventario();
  if (state.view === "carta") content = renderCartaAdmin();
  if (state.view === "delivery") content = renderDelivery();
  if (state.view === "horario") content = renderHorario();
  if (state.view === "caja") content = renderCaja();
  if (state.view === "reportes") content = renderReportes();

  app.innerHTML = shell(content);
  bindShell();
}

function bindShell() {
  document.getElementById("btn-logout")?.addEventListener("click", () => {
    clearSession();
    state.user = null;
    state.authScreen = "login";
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
        if (state.view === "carta") state.productos = await api.productos();
        if (state.view === "delivery") await loadZonas();
        if (state.view === "horario") await loadHorario();
        if (state.view === "caja") {
          state.cajaPreview = await api.cajaPreview();

          if (state.cajaPreview?.cerrado_en) {
            state.cajaCerrada = state.cajaPreview;
          } else {
            state.cajaCerrada = null;
          }
        }
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
      const rawId = btn.dataset.add;
      if (rawId === "arma-tu-roll") {
        abrirRollModal();
        return;
      }
      const id = Number(rawId);
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
        state.tablaConfig = {
          producto: p,
          rolls,
          nota: "",
          salsas: emptySalsasRollState(),
        };
        state.shawarmaConfig = null;
        state.rollConfig = null;
        state.gohanConfig = null;
        state.confirmSalsa = null;
        state.addModal = null;
        state.cartOpen = false;
        render();
        return;
      }

      if (esGohan(p)) {
        abrirGohanModal();
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
          masa: MASA_DEFAULT,
          salsas,
          cantidad: 1,
        };
        state.tablaConfig = null;
        state.rollConfig = null;
        state.gohanConfig = null;
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
      state.rollConfig = null;
      state.gohanConfig = null;
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
        !l.rollArmado &&
        !l.gohanArmado &&
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
  document.querySelectorAll("[data-tabla-salsa]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.tablaConfig) return;
      const salsa = btn.dataset.tablaSalsa;
      state.tablaConfig.salsas = state.tablaConfig.salsas || emptySalsasRollState();
      state.tablaConfig.salsas[salsa] = !state.tablaConfig.salsas[salsa];
      syncTablaSalsaUI();
    });
  });
  document.getElementById("btn-tabla-confirmar")?.addEventListener("click", () => {
    const cfg = state.tablaConfig;
    if (!cfg) return;
    const p = cfg.producto;
    const salsas = salsasSeleccionadasRoll(cfg.salsas);
    if (salsas.length > 0 && !idSalsaExtra()) {
      toast("Falta el producto «Salsa extra» en la carta. Ejecuta seed_menu.", true);
      return;
    }
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
    const unit = Number(p.precio) + salsas.length * PRECIO_SALSA_EXTRA_ROLL;

    state.cart.push({
      producto: p.id,
      nombre: p.nombre,
      precio: unit,
      precioBase: Number(p.precio),
      cantidad: 1,
      categoria: p.categoria,
      descripcion: p.descripcion || "",
      rolls,
      rolls_quitados: resumen_quitados,
      salsas,
      extrasSalsaRoll: salsas.length,
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
  document.querySelectorAll("[data-masa]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.shawarmaConfig) return;
      state.shawarmaConfig.masa = btn.dataset.masa;
      syncMasaUI();
    });
  });
  document.getElementById("btn-shawarma-reset")?.addEventListener("click", () => {
    if (!state.shawarmaConfig) return;
    hideConfirmSalsa();
    resetShawarmaConfigDefaults(state.shawarmaConfig);
    syncMasaUI();
    syncShawarmaIngsUI();
    syncProteinaUI();
    syncSalsaUI();
  });
  document.getElementById("btn-shawarma-confirmar")?.addEventListener("click", () => {
    const cfg = state.shawarmaConfig;
    if (!cfg) return;
    const p = cfg.producto;
    if (!cfg.masa) {
      toast("Elige la masa", true);
      return;
    }
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
      masa: cfg.masa,
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
      masa: cfg.masa,
    });
    cerrarShawarmaModal();
  });

  // Configurador Arma tu Roll
  document.querySelectorAll("[data-roll-env]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.rollConfig) return;
      state.rollConfig.envoltura = btn.dataset.rollEnv;
      syncRollModalUI();
    });
  });
  document.querySelectorAll("[data-roll-relleno]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.rollConfig) return;
      state.rollConfig.relleno = btn.dataset.rollRelleno;
      syncRollModalUI();
    });
  });
  document.querySelectorAll("[data-roll-acomp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.rollConfig) return;
      const tipo = btn.dataset.rollAcomp;
      if (tipo === "queso") {
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
    btn.addEventListener("click", () => {
      if (!state.rollConfig) return;
      const key = btn.dataset.rollTopping;
      state.rollConfig.toppings[key] = !state.rollConfig.toppings[key];
      syncRollModalUI();
    });
  });
  document.querySelectorAll("[data-roll-salsa]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.rollConfig) return;
      const salsa = btn.dataset.rollSalsa;
      state.rollConfig.salsas[salsa] = !state.rollConfig.salsas[salsa];
      syncRollModalUI();
    });
  });
  document.getElementById("btn-cerrar-roll")?.addEventListener("click", () => {
    cerrarRollModal();
  });
  document.getElementById("roll-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "roll-overlay") cerrarRollModal();
  });
  document.getElementById("btn-roll-dec")?.addEventListener("click", () => {
    if (!state.rollConfig) return;
    state.rollConfig.cantidad = Math.max(1, (state.rollConfig.cantidad || 1) - 1);
    syncRollModalUI();
  });
  document.getElementById("btn-roll-inc")?.addEventListener("click", () => {
    if (!state.rollConfig) return;
    state.rollConfig.cantidad = Math.max(1, (state.rollConfig.cantidad || 1) + 1);
    syncRollModalUI();
  });
  document.getElementById("roll-cantidad")?.addEventListener("change", (e) => {
    if (!state.rollConfig) return;
    state.rollConfig.cantidad = Math.max(1, Number(e.target.value) || 1);
    syncRollModalUI();
  });
  document.getElementById("btn-roll-confirmar")?.addEventListener("click", () => {
    const cfg = state.rollConfig;
    if (!cfg || !rollConfigCompleta(cfg)) {
      toast("Elige envoltura, relleno y acompañamiento", true);
      return;
    }
    const { envSel, tops, salsas, unit } = rollModalSnapshot(cfg);
    if (!envSel) {
      toast("Falta la envoltura en la carta. Ejecuta seed_menu.", true);
      return;
    }
    if (salsas.length > 0 && !idSalsaExtra()) {
      toast("Falta el producto «Salsa extra» en la carta. Ejecuta seed_menu.", true);
      return;
    }
    const cantidad = Math.max(
      1,
      Number(document.getElementById("roll-cantidad")?.value) || cfg.cantidad || 1
    );
    const toppingsLabels = tops.map((t) => t.label);
    const rollArmado = labelRollArmado({
      envoltura: cfg.envoltura,
      relleno: cfg.relleno,
      acompanamientoTipo: cfg.acompanamientoTipo,
      vegetal: cfg.vegetal,
      toppingsLabels,
      salsas,
    });
    state.cart.push({
      producto: envSel.producto.id,
      nombre: "Arma tu Roll",
      precio: unit,
      precioBase: Number(envSel.precio),
      cantidad,
      categoria: "rolls",
      descripcion: "",
      rollArmado,
      salsas,
      extrasSalsaRoll: salsas.length,
      toppingsDetalle: tops.map((t) => ({
        id: t.productoObj.id,
        nombre: t.producto,
        label: t.label,
        precio: t.precio,
      })),
    });
    cerrarRollModal();
  });

  // Configurador Arma tu Gohan
  document.querySelectorAll("[data-gohan-espol]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.gohanConfig) return;
      state.gohanConfig.espolvoreado = btn.dataset.gohanEspol;
      syncGohanModalUI();
    });
  });
  document.querySelectorAll("[data-gohan-proteina]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.gohanConfig) return;
      state.gohanConfig.proteina = btn.dataset.gohanProteina;
      syncGohanModalUI();
    });
  });
  document.getElementById("btn-gohan-furay")?.addEventListener("click", () => {
    if (!state.gohanConfig) return;
    state.gohanConfig.furay = !state.gohanConfig.furay;
    syncGohanModalUI();
  });
  document.querySelectorAll("[data-gohan-veg]").forEach((btn) => {
    btn.addEventListener("click", () => {
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
  document.getElementById("btn-cerrar-gohan")?.addEventListener("click", () => {
    cerrarGohanModal();
  });
  document.getElementById("gohan-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "gohan-overlay") cerrarGohanModal();
  });
  document.getElementById("btn-gohan-dec")?.addEventListener("click", () => {
    if (!state.gohanConfig) return;
    state.gohanConfig.cantidad = Math.max(1, (state.gohanConfig.cantidad || 1) - 1);
    syncGohanModalUI();
  });
  document.getElementById("btn-gohan-inc")?.addEventListener("click", () => {
    if (!state.gohanConfig) return;
    state.gohanConfig.cantidad = Math.max(1, (state.gohanConfig.cantidad || 1) + 1);
    syncGohanModalUI();
  });
  document.getElementById("gohan-cantidad")?.addEventListener("change", (e) => {
    if (!state.gohanConfig) return;
    state.gohanConfig.cantidad = Math.max(1, Number(e.target.value) || 1);
    syncGohanModalUI();
  });
  document.getElementById("btn-gohan-confirmar")?.addEventListener("click", () => {
    const cfg = state.gohanConfig;
    if (!cfg || !gohanConfigCompleta(cfg)) {
      toast("Elige espolvoreado, proteína y 2 vegetales", true);
      return;
    }
    const { p, furay, precioFuray, unit } = gohanModalSnapshot(cfg);
    if (!p) {
      toast("Falta el producto Gohan. Ejecuta seed_menu.", true);
      return;
    }
    if (cfg.furay && !furay) {
      toast(`Falta el producto «${NOMBRE_FURAY}». Ejecuta seed_menu.`, true);
      return;
    }
    const cantidad = Math.max(
      1,
      Number(document.getElementById("gohan-cantidad")?.value) || cfg.cantidad || 1
    );
    state.cart.push({
      producto: p.id,
      nombre: "Arma tu Gohan",
      precio: unit,
      precioBase: Number(p.precio),
      cantidad,
      categoria: "gohan",
      descripcion: "",
      gohanArmado: labelGohanArmado(cfg),
      furay: Boolean(cfg.furay),
      extrasFuray: cfg.furay ? 1 : 0,
      furayProductoId: furay?.id || null,
      furayPrecio: precioFuray,
    });
    cerrarGohanModal();
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

  if (state.metodo_pago !== "mixto") {
    state.pago_mixto = {
      efectivo: 0,
      debito: 0,
      credito: 0,
      transferencia: 0,
    };
  }

  render();
});
document.querySelectorAll("[data-pago-mixto]").forEach((input) => {
  input.addEventListener("input", (e) => {
    const metodo = e.target.dataset.pagoMixto;

    state.pago_mixto[metodo] = Math.max(
      0,
      Number(e.target.value) || 0
    );
    const totalIngresado = Object.values(state.pago_mixto).reduce(
  (total, monto) => total + (Number(monto) || 0),
  0
);

const resumen = document.getElementById("resumen-pago-mixto");

if (resumen) {
  resumen.textContent =
    `Ingresado: ${money(totalIngresado)} · Total venta: ${money(cartTotal())}`;
}
  });
});
  document.getElementById("tipo_entrega")?.addEventListener("change", (e) => {
    state.tipo_entrega = e.target.value;
    if (state.tipo_entrega === "retiro") {
      state.cobro_delivery = 0;
      state.zona_delivery_id = null;
      state.direccion_delivery = "";
    } else if (!zonaSeleccionada()) {
      const primera = zonasActivas()[0];
      if (primera) aplicarZona(primera.id);
    } else {
      aplicarZona(state.zona_delivery_id);
    }
    render();
  });
  document.getElementById("zona_delivery")?.addEventListener("change", (e) => {
    aplicarZona(e.target.value);
    render();
  });

  document.getElementById("direccion_delivery")?.addEventListener("input", (e) => {
    state.direccion_delivery = e.target.value;
  });

  document.getElementById("nota_pedido")?.addEventListener("input", (e) => {
    state.nota_pedido = e.target.value;
  });

  document.getElementById("cliente_nombre")?.addEventListener("input", (e) => {
  state.cliente_nombre = e.target.value;
  });

  document.getElementById("paga_con")?.addEventListener("input", (e) => {
  state.paga_con = e.target.value;
  const vueltoEl = document.getElementById("vuelto-display");
  if (vueltoEl) {
    const pagaCon = Number(state.paga_con) || 0;
    const total = cartTotal();
    const vuelto = Math.max(0, pagaCon - total);

    vueltoEl.textContent = money(vuelto);
    vueltoEl.style.color = pagaCon < total ? '#d9534f' : '#2e7d32';
  }
});
  

document.getElementById("metodo_pago")?.addEventListener("change", (e) => {
  state.metodo_pago = e.target.value;
  if (state.metodo_pago !== "Efectivo" && state.metodo_pago !== "efectivo") {
    state.paga_con = ""; // Se limpia si cambias a Tarjeta o Transferencia
  }
  render();
});

  document.getElementById("btn-limpiar")?.addEventListener("click", () => {
    state.cart = [];
    state.cartOpen = false;
    state.nota_pedido = "";
    state.cliente_nombre = "";
    state.paga_con = "";
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
    const ventaConCliente = {
      ...state.postCobro,
      cliente_nombre:
        state.postCobro.cliente_nombre ||
        state.postCobro.cliente ||
        state.cliente_nombre ||
        document.getElementById("cliente_nombre")?.value.trim() ||
        "",
    };
    if (!imprimirTicketCliente(normalizarVentaParaTicket(ventaConCliente))) {
      toast("Permite ventanas emergentes para imprimir", true);
    }
  });

  document.getElementById("btn-print-cocina")?.addEventListener("click", () => {
    if (!state.postCobro) return;
    const ventaConCliente = {
    ...state.postCobro,
    cliente_nombre:
      state.postCobro.cliente_nombre ||
      state.postCobro.cliente ||
      state.cliente_nombre ||
      document.getElementById("cliente_nombre")?.value.trim() ||
      "",
    };
    if (!imprimirComandaCocina(normalizarVentaParaTicket(ventaConCliente))) {
      toast("Permite ventanas emergentes para imprimir", true);
    }
  });
  
  document.getElementById("reporte-fecha")?.addEventListener("change", async (e) => {
  state.reporteFecha = e.target.value;

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

  document.getElementById("form-zona")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = document.getElementById("zona-nombre").value.trim();
    const descripcion = document.getElementById("zona-descripcion").value.trim();
    const precio = Math.round(Number(document.getElementById("zona-precio").value));
    const body = {
      nombre,
      descripcion,
      precio,
    };
    try {
      if (state.zonaForm?.id) {
        await api.actualizarZonaDelivery(state.zonaForm.id, body);
        toast("Zona actualizada");
      } else {
        await api.crearZonaDelivery(body);
        toast("Zona agregada");
      }
      cerrarZonaModal();
      await loadZonas();
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.getElementById("btn-reintentar-horario")?.addEventListener("click", async () => {
    await loadHorario();
    render();
  });

  document.querySelectorAll("#form-horario [data-dia]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!state.horarioLoaded || btn.disabled) return;
      const key = btn.dataset.dia;
      const input = document.querySelector(`#form-horario [name="${key}"]`);
      if (!input) return;
      const on = !input.checked;
      input.checked = on;
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  });

  const bindTurnoToggle = (activoName, inicioName, finName) => {
    document.querySelector(`#form-horario [name="${activoName}"]`)?.addEventListener(
      "change",
      (e) => {
        if (!state.horarioLoaded) return;
        const on = e.target.checked;
        [inicioName, finName].forEach((name) => {
          const input = document.querySelector(`#form-horario [name="${name}"]`);
          if (!input) return;
          input.disabled = !on;
          input.required = on;
        });
      }
    );
  };
  bindTurnoToggle("turno1_activo", "turno1_inicio", "turno1_fin");
  bindTurnoToggle("turno2_activo", "turno2_inicio", "turno2_fin");

  document.getElementById("form-horario")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.horarioLoaded || !state.horarioForm) {
      toast("No se pudo cargar el horario. Reintenta antes de guardar.", true);
      return;
    }
    const form = e.target;
    const bool = (name) => Boolean(form.elements[name]?.checked);
    if (!bool("turno1_activo") && !bool("turno2_activo")) {
      toast("Activa al menos un turno (1 o 2).", true);
      return;
    }
    const body = {
      habilitado: bool("habilitado"),
      lunes: bool("lunes"),
      martes: bool("martes"),
      miercoles: bool("miercoles"),
      jueves: bool("jueves"),
      viernes: bool("viernes"),
      sabado: bool("sabado"),
      domingo: bool("domingo"),
      turno1_activo: bool("turno1_activo"),
      turno1_inicio: form.elements.turno1_inicio.value || "12:00",
      turno1_fin: form.elements.turno1_fin.value || "15:45",
      turno2_activo: bool("turno2_activo"),
      turno2_inicio: form.elements.turno2_inicio.value || "18:00",
      turno2_fin: form.elements.turno2_fin.value || "22:45",
      texto_horario: form.elements.texto_horario.value.trim(),
      mensaje_cerrado: form.elements.mensaje_cerrado.value.trim(),
    };
    state.horarioSaving = true;
    state.horarioError = "";
    render();
    try {
      state.horarioForm = horarioFormFromApi(await api.guardarHorarioPedidos(body));
      state.horarioLoaded = true;
      toast("Horario guardado");
    } catch (err) {
      state.horarioError = err.message || "No se pudo guardar";
      toast(state.horarioError, true);
    } finally {
      state.horarioSaving = false;
      render();
    }
  });

  document.getElementById("carta-filtro")?.addEventListener("change", (e) => {
    state.cartaFiltro = e.target.value;
    render();
  });
  document.getElementById("carta-buscar")?.addEventListener("input", (e) => {
    state.cartaBusqueda = e.target.value;
    render();
    const input = document.getElementById("carta-buscar");
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  });

  document.getElementById("btn-agregar-producto")?.addEventListener("click", () => {
    state.productoForm = emptyProductoForm();
    state.productoModalOpen = true;
    render();
    document.getElementById("prod-nombre")?.focus();
  });

  const cerrarModalProducto = () => {
    cerrarProductoModal();
    render();
  };
  document.getElementById("btn-cancelar-producto")?.addEventListener("click", cerrarModalProducto);
  document.getElementById("btn-cerrar-producto")?.addEventListener("click", cerrarModalProducto);
  document.getElementById("producto-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "producto-overlay") cerrarModalProducto();
  });

  document.getElementById("form-producto")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      nombre: document.getElementById("prod-nombre").value.trim(),
      descripcion: document.getElementById("prod-descripcion").value.trim(),
      precio: Math.round(Number(document.getElementById("prod-precio").value)),
      categoria: document.getElementById("prod-categoria").value,
      estado: document.getElementById("prod-visible")?.checked
        ? "activo"
        : "inactivo",
    };
    try {
      if (state.productoForm?.id) {
        await api.actualizarProducto(state.productoForm.id, body);
        toast("Producto actualizado");
      } else {
        await api.crearProducto(body);
        toast("Producto agregado");
      }
      cerrarProductoModal();
      state.productos = await api.productos();
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.querySelectorAll("[data-prod-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wrap = btn.closest(".kebab");
      const menu = wrap?.querySelector(".kebab-menu");
      const open = menu && !menu.hidden;
      document.querySelectorAll(".kebab-menu").forEach((el) => {
        el.hidden = true;
      });
      document.querySelectorAll("[data-prod-menu],[data-zona-menu]").forEach((el) => {
        el.setAttribute("aria-expanded", "false");
      });
      if (menu && !open) {
        menu.hidden = false;
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });

  document.querySelectorAll("[data-editar-prod]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = state.productos.find((x) => String(x.id) === String(btn.dataset.editarProd));
      if (!p) return;
      state.productoForm = {
        id: p.id,
        nombre: p.nombre || "",
        descripcion: p.descripcion || "",
        precio: precioInputClp(p.precio),
        categoria: p.categoria || "picoteo",
        estado: p.estado || "activo",
      };
      state.productoModalOpen = true;
      render();
    });
  });

  document.getElementById("btn-agregar-zona")?.addEventListener("click", () => {
    state.zonaForm = emptyZonaForm();
    state.zonaModalOpen = true;
    render();
    document.getElementById("zona-nombre")?.focus();
  });

  const cerrarModalZona = () => {
    cerrarZonaModal();
    render();
  };
  document.getElementById("btn-cancelar-zona")?.addEventListener("click", cerrarModalZona);
  document.getElementById("btn-cerrar-zona")?.addEventListener("click", cerrarModalZona);
  document.getElementById("zona-overlay")?.addEventListener("click", (e) => {
    if (e.target.id === "zona-overlay") cerrarModalZona();
  });

  if (!window.__zonaMenuOutside) {
    window.__zonaMenuOutside = true;
    document.addEventListener("click", () => {
      document.querySelectorAll(".kebab-menu").forEach((el) => {
        el.hidden = true;
      });
      document.querySelectorAll("[data-zona-menu]").forEach((el) => {
        el.setAttribute("aria-expanded", "false");
      });
    });
  }

  document.querySelectorAll("[data-zona-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wrap = btn.closest(".kebab");
      const menu = wrap?.querySelector(".kebab-menu");
      const willOpen = menu?.hidden !== false;
      document.querySelectorAll(".kebab-menu").forEach((el) => {
        el.hidden = true;
      });
      document.querySelectorAll("[data-zona-menu]").forEach((el) => {
        el.setAttribute("aria-expanded", "false");
      });
      if (willOpen && menu) {
        menu.hidden = false;
        btn.setAttribute("aria-expanded", "true");
      }
    });
  });

  document.querySelectorAll("[data-editar-zona]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const zona = state.zonas.find((z) => String(z.id) === String(btn.dataset.editarZona));
      if (!zona) return;
      state.zonaForm = {
        id: zona.id,
        nombre: zona.nombre || "",
        descripcion: zona.descripcion || "",
        precio: precioInputClp(zona.precio) || "0",
      };
      state.zonaModalOpen = true;
      render();
      document.getElementById("zona-nombre")?.focus();
    });
  });

  document.querySelectorAll("[data-eliminar-zona]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const zona = state.zonas.find((z) => String(z.id) === String(btn.dataset.eliminarZona));
      if (!confirm(`¿Eliminar la zona ${zona?.nombre || ""}?`)) return;
      try {
        await api.eliminarZonaDelivery(btn.dataset.eliminarZona);
        if (String(state.zonaForm?.id) === String(btn.dataset.eliminarZona)) {
          cerrarZonaModal();
        }
        await loadZonas();
        toast("Zona eliminada");
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
  });

  document.getElementById("form-agregar-inv")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nombre = document.getElementById("nombre-inv").value.trim();
    const cantidad = Number(document.getElementById("cantidad-inv").value);
    const notas = document.getElementById("notas-inv").value.trim();

    if (!nombre) {
      toast("Ingresa el nombre del empaque", true);
      return;
    }

    if (!Number.isInteger(cantidad) || cantidad < 0) {
      toast("Las unidades deben ser un número entero igual o mayor a 0", true);
      return;
    }

    try {
      await api.agregarInventario({
        nombre,
        cantidad,
        notas,
      });

      state.inventario = await api.inventario();
      toast("Empaque agregado al inventario");
      render();
    } catch (err) {
      toast(err.message, true);
    }
  });

  document.querySelectorAll("[data-guardar-inv]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.guardarInv;

      const nombre = document
        .getElementById(`nombre-inv-${id}`)
        .value.trim();

      const cantidad = Number(
        document.getElementById(`cantidad-inv-${id}`).value
      );

      const notas = document
        .getElementById(`notas-inv-${id}`)
        .value.trim();

      if (!nombre) {
        toast("El nombre del empaque no puede estar vacío", true);
        return;
      }

      if (!Number.isInteger(cantidad) || cantidad < 0) {
        toast("Las unidades deben ser un número entero igual o mayor a 0", true);
        return;
      }

      try {
        await api.patchInventario(id, {
          nombre,
          cantidad,
          notas,
        });

        state.inventario = await api.inventario();
        toast("Inventario actualizado");
        render();
      } catch (err) {
        toast(err.message, true);
      }
    });
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
      state.cajaCerrada = await api.cajaPreview(fecha);
      toast(`Caja cerrada: ${formatFecha(fecha)}`);
      state.cajaPreview = await api.cajaPreview(fecha);
      render();
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("btn-imprimir-cierre")?.addEventListener("click", () => {
    if (!state.cajaCerrada) return;

    const ok = imprimirCierreCaja(state.cajaCerrada);

    if (!ok) {
      toast("Permite ventanas emergentes para imprimir el cierre", true);
    }
  });
}

async function cobrar() {
  if (!state.cart.length) {
    toast("Agrega al menos un producto para enviar el pedido", true);
    return;
  }

  if (state.tipo_entrega === "delivery") {
    if (state.online) {
      await loadZonas();
      if (state.zonasError) {
        toast(state.zonasError, true);
        return;
      }
      const vista = zonaSeleccionada();
      const precioVisto = Number(state.cobro_delivery) || 0;
      const vigente = zonasActivas().find((z) => String(z.id) === String(vista?.id));
      if (!vigente) {
        state.zona_delivery_id = null;
        state.cobro_delivery = 0;
        toast("Esa zona ya no está. Elige otra.", true);
        render();
        return;
      }
      aplicarZona(vigente.id);
      if ((Number(vigente.precio) || 0) !== precioVisto) {
        toast(`El delivery ahora es ${money(vigente.precio)}. Revisa el total y cobra de nuevo.`, true);
        render();
        return;
      }
    }
    const zona = zonaSeleccionada();
    if (!zona) {
      toast("Elige una zona de delivery.", true);
      return;
    }
    const dir = (state.direccion_delivery || "").trim();
    if (!dir) {
      toast("Indica la dirección de delivery", true);
      document.getElementById("direccion_delivery")?.focus();
      return;
    }
    state.direccion_delivery = dir;
  }

  

  const notaParts = [];
  if (state.tipo_entrega === "delivery") {
    const zona = zonaSeleccionada();
    if (zona) {
      const cobertura = zona.descripcion ? ` (${zona.descripcion})` : "";
      notaParts.push(`Zona: ${zona.nombre}${cobertura}`);
    }
  }
  if (state.tipo_entrega === "delivery" && state.direccion_delivery.trim()) {
    notaParts.push(`Dirección: ${state.direccion_delivery.trim()}`);
  }
  if ((state.nota_pedido || "").trim()) {
    notaParts.push(state.nota_pedido.trim());
  }
  const notasPedido = notaParts.join(" || ");
  const pagaConMonto = Number(state.paga_con) || 0;
  const vueltoCalculado = Math.max(0, pagaConMonto - cartTotal());
  const inputCliente = document.getElementById("cliente_nombre");
  if (inputCliente) {
    state.cliente_nombre = inputCliente.value.trim();
  }
  const totalVenta = cartTotal();
  let pagos = [];

if (state.metodo_pago === "mixto") {
  pagos = Object.entries(state.pago_mixto)
    .map(([metodo, monto]) => ({
      metodo,
      monto: Number(monto) || 0,
    }))
    .filter((pago) => pago.monto > 0);

  const totalPagos = pagos.reduce(
    (total, pago) => total + pago.monto,
    0
  );

  if (pagos.length < 2) {
    toast("El pago mixto debe usar al menos dos medios de pago", true);
    return;
  }

  if (totalPagos !== totalVenta) {
    toast(
      `Los pagos suman ${money(totalPagos)} y la venta total es ${money(totalVenta)}`,
      true
    );
    return;
  }
} else {
  pagos = [
    {
      metodo: state.metodo_pago,
      monto: totalVenta,
    },
  ];
}
// Abrir ventanas de impresión solo después de validar el pago
  const ventanasPrint = prepararVentanasImpresion();

  const payload = {
    client_uuid: crypto.randomUUID(),
    fecha_hora: new Date().toISOString(),
    cajero_id: state.user?.id ?? null,
    metodo_pago:
      state.metodo_pago === "debito" || state.metodo_pago === "credito"
        ? "tarjeta"
        : state.metodo_pago === "mixto"
          ? "efectivo"
          : state.metodo_pago,
    paga_con: state.metodo_pago === "Efectivo" || state.metodo_pago === "efectivo" ? pagaConMonto : cartTotal(),
    vuelto: state.metodo_pago === "Efectivo" || state.metodo_pago === "efectivo" ? vueltoCalculado : 0,
    pagos: pagos.map((pago) => ({
      metodo: pago.metodo,
      monto: String(pago.monto),
    })),
    tipo_entrega: state.tipo_entrega,
    cliente_nombre: state.cliente_nombre || document.getElementById('cliente_nombre')?.value || "",
    cobro_delivery: state.tipo_entrega === "delivery" ? String(state.cobro_delivery || 0) : "0",
    zona_delivery: state.tipo_entrega === "delivery" ? zonaSeleccionada()?.id ?? null : null,
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
      if (l.rollArmado) {
        notas = l.rollArmado;
      }
      if (l.gohanArmado) {
        notas = l.gohanArmado;
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
      const extrasSalsaRoll = Number(l.extrasSalsaRoll) || 0;
      if (extrasSalsaRoll > 0) {
        const salsaId = idSalsaExtra();
        if (salsaId) {
          rows.push({
            producto: salsaId,
            cantidad: extrasSalsaRoll * l.cantidad,
            nombre: "Salsa extra",
            precio: PRECIO_SALSA_EXTRA_ROLL,
            notas: `Salsas de ${l.nombre}: ${(l.salsas || []).join(", ")}`,
            rolls: [],
            rolls_quitados: [],
          });
        }
      }
      for (const t of l.toppingsDetalle || []) {
        rows.push({
          producto: t.id,
          cantidad: l.cantidad,
          nombre: t.nombre,
          precio: t.precio,
          notas: `Topping ${t.label} en Arma tu Roll`,
          rolls: [],
          rolls_quitados: [],
        });
      }
      const extrasFuray = Number(l.extrasFuray) || 0;
      if (extrasFuray > 0 && l.furayProductoId) {
        rows.push({
          producto: l.furayProductoId,
          cantidad: extrasFuray * l.cantidad,
          nombre: NOMBRE_FURAY,
          precio: l.furayPrecio,
          notas: `Furay en Arma tu Gohan`,
          rolls: [],
          rolls_quitados: [],
        });
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
          pagos: payload.pagos,
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
    
    const datosVenta = {
      ...payload,
      ...(ventaApi || {}),
      cliente_nombre: payload.cliente_nombre || payload.cliente || (ventaApi && ventaApi.cliente_nombre) || ""
    };

    state.postCobro = normalizarVentaParaTicket(ventaApi || payload, {
  offline,
  cajero: state.user?.username,
});

// LÍNEA ÚNICA Y SEGURA: inyecta el cliente directamente si no venía en la respuesta
if (state.postCobro) {
  state.postCobro.cliente_nombre = payload.cliente_nombre || payload.cliente || state.cliente_nombre || "";
}

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

function imprimirCierreCaja(cierre) {
  if (!cierre) return false;

  const nombreMetodo = (metodo) => {
    const nombres = {
      efectivo: "Efectivo",
      debito: "Débito",
      credito: "Crédito",
      transferencia: "Transferencia",
      webpay: "Webpay",
      tarjeta: "Tarjeta",
    };

    return nombres[metodo] || metodo;
  };

  const movimientos = (cierre.movimientos || [])
    .map((mov) => {
      const pagos = (mov.pagos || [])
        .map(
          (pago) =>
            `${nombreMetodo(pago.metodo)} ${money(pago.monto)}`
        )
        .join(" + ");

      const hora = mov.fecha_hora
        ? new Date(mov.fecha_hora).toLocaleTimeString("es-CL", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—";

      return `
        <tr>
          <td>#${escapeHtml(mov.venta_id)}</td>
          <td>${escapeHtml(hora)}</td>
          <td>${escapeHtml(mov.cajero || "—")}</td>
          <td>${escapeHtml(pagos || "—")}</td>
          <td class="numero">${money(mov.total)}</td>
        </tr>
      `;
    })
    .join("");

  const html = `
    <!DOCTYPE html>
    <html lang="es-CL">
      <head>
        <meta charset="utf-8" />
        <title>Cierre de caja ${escapeHtml(cierre.fecha)}</title>

        <style>
          body {
            font-family: system-ui, sans-serif;
            padding: 32px;
            color: #111;
          }

          h1 {
            margin-bottom: 4px;
          }

          .subtitulo {
            margin-top: 0;
            color: #555;
          }

          .estado {
            display: inline-block;
            margin: 12px 0 20px;
            padding: 6px 12px;
            border: 2px solid #111;
            border-radius: 20px;
            font-weight: 700;
          }

          .resumen {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px 24px;
            margin: 16px 0 28px;
          }

          .total {
            font-size: 18px;
            font-weight: 800;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 12px;
          }

          th,
          td {
            padding: 8px 6px;
            border-bottom: 1px solid #ccc;
            text-align: left;
            font-size: 13px;
          }

          th {
            font-weight: 700;
          }

          .numero {
            text-align: right;
            font-weight: 700;
          }

          @media print {
            body {
              padding: 0;
            }
          }
        </style>
      </head>

      <body>
        <h1>El Tenedor — Cierre de caja</h1>

        <p class="subtitulo">
          Fecha: <strong>${escapeHtml(formatFecha(cierre.fecha))}</strong>
        </p>

        <div class="estado">CAJA CERRADA</div>

        <div class="resumen">
          <div>Efectivo: <strong>${money(cierre.total_efectivo)}</strong></div>
          <div>Débito: <strong>${money(cierre.total_debito)}</strong></div>
          <div>Crédito: <strong>${money(cierre.total_credito)}</strong></div>
          <div>Transferencias: <strong>${money(cierre.total_transferencias)}</strong></div>
          <div>Webpay: <strong>${money(cierre.total_webpay)}</strong></div>
          <div>Ventas: <strong>${cierre.cantidad_ventas ?? 0}</strong></div>
          <div class="total">
            Total: ${money(cierre.total_general)}
          </div>
        </div>

        <h2>Detalle de movimientos</h2>

        <table>
          <thead>
            <tr>
              <th>Venta</th>
              <th>Hora</th>
              <th>Cajero</th>
              <th>Forma de pago</th>
              <th style="text-align:right">Total</th>
            </tr>
          </thead>

          <tbody>
            ${
              movimientos ||
              `
                <tr>
                  <td colspan="5">
                    No hubo movimientos durante el día.
                  </td>
                </tr>
              `
            }
          </tbody>
        </table>
      </body>
    </html>
  `;

  const ventana = window.open("", "_blank");

  if (!ventana) return false;

  ventana.document.open();
  ventana.document.write(html);
  ventana.document.close();

  ventana.onload = () => {
    ventana.focus();
    ventana.print();
  };

  return true;
}

function imprimirReporteDiario(r) {
  if (!r) {
    toast("Primero carga un reporte", true);
    return;
  }

  const rows = (r.por_producto || [])
    .map(
      (p) => `
        <tr>
          <td>${escapeHtml(p.nombre)}</td>
          <td class="center">${p.cantidad}</td>
          <td class="right">${money(p.monto)}</td>
        </tr>
      `
    )
    .join("");

  const fecha = formatFecha(r.fecha);

  const html = `
    <!DOCTYPE html>
    <html lang="es-CL">
    <head>
      <meta charset="utf-8" />
      <title>Reporte diario ${escapeHtml(fecha)}</title>

      <style>
        * {
          box-sizing: border-box;
        }

        body {
          font-family: Arial, Helvetica, sans-serif;
          color: #222;
          margin: 0;
          padding: 28px;
          background: #fff;
        }

        .reporte {
          max-width: 760px;
          margin: 0 auto;
        }

        .header {
          border-bottom: 2px solid #222;
          padding-bottom: 14px;
          margin-bottom: 20px;
        }

        .marca {
          font-size: 24px;
          font-weight: 800;
          margin: 0;
        }

        .subtitulo {
          margin: 4px 0 0;
          color: #666;
          font-size: 13px;
        }

        .fecha {
          margin-top: 10px;
          font-size: 14px;
        }

        h2 {
          font-size: 15px;
          margin: 22px 0 10px;
          text-transform: uppercase;
          letter-spacing: .5px;
        }

        .resumen {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }

        .dato {
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 10px 12px;
        }

        .dato-label {
          color: #666;
          font-size: 11px;
          text-transform: uppercase;
          margin-bottom: 4px;
        }

        .dato-valor {
          font-size: 17px;
          font-weight: 700;
        }

        .pagos {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8px;
        }

        .pago {
          border: 1px solid #ddd;
          border-radius: 7px;
          padding: 9px;
          font-size: 12px;
        }

        .pago strong {
          display: block;
          margin-top: 4px;
          font-size: 14px;
        }

        .entregas {
          display: flex;
          gap: 30px;
          border: 1px solid #ddd;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 13px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 8px;
        }

        th {
          background: #f4f4f4;
          font-size: 12px;
          text-transform: uppercase;
          text-align: left;
          padding: 9px 8px;
          border-bottom: 1px solid #ccc;
        }

        td {
          font-size: 13px;
          padding: 9px 8px;
          border-bottom: 1px solid #e5e5e5;
        }

        .center {
          text-align: center;
        }

        .right {
          text-align: right;
        }

        .footer {
          margin-top: 28px;
          padding-top: 12px;
          border-top: 1px solid #ddd;
          text-align: center;
          color: #777;
          font-size: 11px;
        }

        @media print {
          body {
            padding: 0;
          }

          .reporte {
            max-width: none;
          }
        }
      </style>
    </head>

    <body>
      <main class="reporte">

        <header class="header">
          <p class="marca">el Tenedor</p>
          <p class="subtitulo">Reporte diario de ventas</p>
          <div class="fecha">
            <strong>Fecha:</strong> ${escapeHtml(fecha)}
          </div>
        </header>

        <h2>Resumen del día</h2>

        <div class="resumen">
          <div class="dato">
            <div class="dato-label">Ventas</div>
            <div class="dato-valor">${r.cantidad_ventas}</div>
          </div>

          <div class="dato">
            <div class="dato-label">Anuladas</div>
            <div class="dato-valor">${r.cantidad_anuladas}</div>
          </div>

          <div class="dato">
            <div class="dato-label">Total del día</div>
            <div class="dato-valor">${money(r.total_general)}</div>
          </div>
        </div>

        <h2>Medios de pago</h2>

        <div class="pagos">
          <div class="pago">
            Efectivo
            <strong>${money(r.total_efectivo)}</strong>
          </div>

          <div class="pago">
            Débito
            <strong>${money(r.total_debito)}</strong>
          </div>

          <div class="pago">
            Crédito
            <strong>${money(r.total_credito)}</strong>
          </div>

          <div class="pago">
            Transferencia
            <strong>${money(r.total_transferencias)}</strong>
          </div>

          <div class="pago">
            Webpay
            <strong>${money(r.total_webpay)}</strong>
          </div>
        </div>

        <h2>Entregas</h2>

        <div class="entregas">
          <span>
            Retiro:
            <strong>${r.por_entrega?.retiro ?? 0}</strong>
          </span>

          <span>
            Delivery:
            <strong>${r.por_entrega?.delivery ?? 0}</strong>
          </span>
        </div>

        <h2>Detalle de productos vendidos</h2>

        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th class="center">Cantidad</th>
              <th class="right">Monto</th>
            </tr>
          </thead>

          <tbody>
            ${
              rows ||
              `
                <tr>
                  <td colspan="3">Sin ventas registradas ese día.</td>
                </tr>
              `
            }
          </tbody>
        </table>

        <div class="footer">
          Reporte generado por el sistema de gestión de el Tenedor.
        </div>

      </main>

      <script>
        window.addEventListener("load", () => {
          setTimeout(() => window.print(), 250);
        });
      </script>
    </body>
    </html>
  `;

  const w = window.open("", "_blank", "width=820,height=900");

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