const rawBase = import.meta.env.VITE_API_URL || "";
const API_BASE = String(rawBase).replace(/\/$/, "");

const TOKEN_KEY = "el_tenedor_tokens";
const USER_KEY = "el_tenedor_user";

export function getTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
  } catch {
    return null;
  }
}

export function setTokens(tokens) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getCachedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

export function setCachedUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

async function request(path, options = {}) {
  const tokens = getTokens();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (tokens?.access) {
    headers.Authorization = `Bearer ${tokens.access}`;
  }

  let res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401 && tokens?.refresh) {
    const refreshed = await refreshAccess(tokens.refresh);
    if (refreshed) {
      headers.Authorization = `Bearer ${refreshed.access}`;
      res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    }
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    let detail =
      (typeof data?.detail === "string" && data.detail) ||
      (Array.isArray(data?.non_field_errors) && data.non_field_errors.join(" ")) ||
      (typeof data?.productos === "string" && data.productos) ||
      (data && typeof data === "object" && JSON.stringify(data) !== "null"
        ? JSON.stringify(data)
        : null) ||
      (typeof data === "string" ? data : null) ||
      text ||
      res.statusText ||
      `Error HTTP ${res.status}`;
    if (typeof detail === "string" && /<!DOCTYPE html>|<html[\s>]/i.test(detail)) {
      const title = detail.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
      const pre = detail.match(/<pre class="exception_value">([^<]+)<\/pre>/i)?.[1]?.trim();
      detail =
        pre ||
        title ||
        `Error del servidor (HTTP ${res.status}). Revisa migraciones o reinicia la API.`;
    }
    if (detail === "null" || detail === "{}" || detail === "[]") {
      detail = `No se pudo conectar con el servidor (HTTP ${res.status}). ¿Está corriendo la API?`;
    }
    const err = new Error(detail);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** DRF PageNumberPagination entrega {count, next, previous, results}. */
function asList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

/** Sigue `next` hasta traer todas las páginas (la carta no cabe en las 50 primeras). */
async function fetchAllPages(path) {
  const data = await request(path);
  if (Array.isArray(data)) return data;
  const all = asList(data);
  let next = data?.next;
  while (next) {
    const url = new URL(next, "http://local");
    const page = await request(`${url.pathname}${url.search}`);
    all.push(...asList(page));
    next = page?.next;
  }
  return all;
}

async function refreshAccess(refresh) {
  try {
    const res = await fetch(`${API_BASE}/api/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) {
      clearSession();
      return null;
    }
    const data = await res.json();
    const next = { ...getTokens(), access: data.access };
    setTokens(next);
    return next;
  } catch {
    return null;
  }
}

export async function login(username, password) {
  const tokens = await request("/api/token/", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  setTokens(tokens);
  const user = await request("/api/me/");
  setCachedUser(user);
  return user;
}

export async function register({
  username,
  password,
  password_confirm,
  first_name = "",
}) {
  const data = await request("/api/registro/", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
      password_confirm,
      first_name,
    }),
  });
  setTokens({ access: data.access, refresh: data.refresh });
  const user = data.user || (await request("/api/me/"));
  setCachedUser(user);
  return user;
}

export const api = {
  me: () => request("/api/me/"),
  productos: () => fetchAllPages("/api/productos/"),
  crearProducto: (body) =>
    request("/api/productos/", { method: "POST", body: JSON.stringify(body) }),
  actualizarProducto: (id, body) =>
    request(`/api/productos/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  inventario: () => request("/api/inventario/").then(asList),
  agregarInventario: (body) =>
    request("/api/inventario/", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  quitarInventario: (id) =>
    request(`/api/inventario/${id}/`, { method: "DELETE" }),
  patchInventario: (id, body) =>
    request(`/api/inventario/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  ventas: () => request("/api/ventas/").then(asList),
  crearVenta: (body) =>
    request("/api/ventas/", { method: "POST", body: JSON.stringify(body) }),
  anularVenta: (id) =>
    request(`/api/ventas/${id}/`, {
      method: "PATCH",
      body: JSON.stringify({ estado: "anulada" }),
    }),
  syncVentas: (lote) =>
    request("/api/sync-ventas/", {
      method: "POST",
      body: JSON.stringify(lote),
    }),
  pedidos: () => request("/api/pedidos/").then(asList),
  recibirPedido: (id) =>
    request(`/api/pedidos/${id}/recibir/`, { method: "POST", body: "{}" }),
  cajaPreview: (fecha) => {
    const q = fecha ? `?fecha=${fecha}` : "";
    return request(`/api/caja-diaria/preview/${q}`);
  },
  cerrarCaja: (fecha) =>
    request("/api/caja-diaria/", {
      method: "POST",
      body: JSON.stringify({ fecha }),
    }),
  cajas: () => request("/api/caja-diaria/").then(asList),
  reporteDiario: (fecha) => {
    const q = fecha ? `?fecha=${fecha}` : "";
    return request(`/api/reportes/diario/${q}`);
  },
  zonasDelivery: () => request("/api/zonas-delivery/").then(asList),
  crearZonaDelivery: (body) =>
    request("/api/zonas-delivery/", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  actualizarZonaDelivery: (id, body) =>
    request(`/api/zonas-delivery/${id}/`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  eliminarZonaDelivery: (id) =>
    request(`/api/zonas-delivery/${id}/`, { method: "DELETE" }),
  horarioPedidosConfig: () => request("/api/horario-pedidos/config/"),
  guardarHorarioPedidos: (body) =>
    request("/api/horario-pedidos/config/", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};
