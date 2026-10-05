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
      text ||
      res.statusText ||
      `Error HTTP ${res.status}`;
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

export const api = {
  me: () => request("/api/me/"),
  productos: () => request("/api/productos/"),
  inventario: () => request("/api/inventario/"),
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
  ventas: () => request("/api/ventas/"),
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
  pedidos: () => request("/api/pedidos/"),
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
  cajas: () => request("/api/caja-diaria/"),
  reporteDiario: (fecha) => {
    const q = fecha ? `?fecha=${fecha}` : "";
    return request(`/api/reportes/diario/${q}`);
  },
  zonasDelivery: () => request("/api/zonas-delivery/"),
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
};
