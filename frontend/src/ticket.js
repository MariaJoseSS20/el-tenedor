/**
 * Impresión de ticket cliente y comanda de cocina (ventana + window.print).
 */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);
}

function calcularIvaIncluido(total) {
  const totalVenta = Math.round(Number(total) || 0);
  const neto = Math.round(totalVenta / 1.19);
  const iva = totalVenta - neto;

  return {
    neto,
    iva,
    total: totalVenta,
  };
}

function fechaLocal(iso) {
  try {
    return new Date(iso).toLocaleString("es-CL");
  } catch {
    return String(iso || "");
  }
}

/** Normaliza venta API o payload offline para impresión. */
export function normalizarVentaParaTicket(ventaOPayload, opts = {}) {
  if (ventaOPayload?.detalles && (ventaOPayload.id || ventaOPayload.total != null)) {
    return {
      id: ventaOPayload.id ?? "—",
      fecha_hora: ventaOPayload.fecha_hora || new Date().toISOString(),
      metodo_pago: ventaOPayload.metodo_pago || "",
      pagos: (ventaOPayload.pagos || []).map((p) => ({
        metodo: p.metodo || "",
        monto: Number(p.monto) || 0,
      })),
      tipo_entrega: ventaOPayload.tipo_entrega || "",
      cobro_delivery: Number(ventaOPayload.cobro_delivery) || 0,
      total: Number(ventaOPayload.total) || 0,
      estado: ventaOPayload.estado || "completada",
      notas: ventaOPayload.notas || "",
      cajero: (typeof ventaOPayload.cajero === "string" ? ventaOPayload.cajero : ventaOPayload.cajero?.username) || opts.cajero || "",
      cliente_nombre: ventaOPayload.cliente_nombre || (typeof ventaOPayload.cliente === "string" ? ventaOPayload.cliente : ventaOPayload.cliente?.nombre) || "",
      paga_con: ventaOPayload.paga_con || null,
      vuelto: ventaOPayload.vuelto || null,
      detalles: (ventaOPayload.detalles || []).map((d) => ({
        nombre: d.producto_nombre || d.nombre || `Producto #${d.producto}`,
        cantidad: d.cantidad,
        subtotal: Number(
          d.subtotal != null
            ? d.subtotal
            : (d.precio || 0) * d.cantidad
        ),
        notas: d.notas || "",
      })),
    };
  }

  const payload = ventaOPayload;

  return {
    id: opts.offline ? "offline" : "—",
    fecha_hora: payload.fecha_hora || new Date().toISOString(),
    metodo_pago: payload.metodo_pago || "",
    pagos: (payload.pagos || []).map((p) => ({
      metodo: p.metodo || "",
      monto: Number(p.monto) || 0,
    })),
    tipo_entrega: payload.tipo_entrega || "",
    cobro_delivery: Number(payload.cobro_delivery) || 0,
    total: Number(payload.total_local) || 0,
    estado: "completada",
    notas: payload.notas || "",
    cajero: opts.cajero || "",
    detalles: (payload.detalles || []).map((d) => ({
      nombre: d.nombre || `Producto #${d.producto}`,
      cantidad: d.cantidad,
      subtotal: Number(d.precio || 0) * Number(d.cantidad || 0),
      notas: d.notas || "",
    })),
  };
}

function documentoHtml(title, bodyInner) {
  return `<!DOCTYPE html>
<html lang="es-CL">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; color: #111; padding: 16px; max-width: 320px; margin: 0 auto; }
    h1 { font-size: 16px; text-align: center; margin-bottom: 4px; }
    .sub { text-align: center; font-size: 11px; margin-bottom: 12px; }
    .meta { margin-bottom: 12px; font-size: 12px; line-height: 1.45; }
    .line { display: flex; justify-content: space-between; gap: 8px; margin: 6px 0; }
    .notas { font-size: 11px; color: #333; margin-left: 8px; white-space: pre-wrap; }
    hr { border: none; border-top: 1px dashed #333; margin: 10px 0; }
    .total { font-size: 15px; font-weight: 700; display: flex; justify-content: space-between; }
    .banner { text-align: center; font-weight: 700; letter-spacing: 0.04em; margin-bottom: 8px; font-size: 14px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>${bodyInner}
<script>window.onload = function () { setTimeout(function () { window.print(); }, 200); };</script>
</body>
</html>`;
}
export function imprimirTicketCliente(ventaNorm, win = null) {
  const impuestos = calcularIvaIncluido(ventaNorm.total);

  const lineas = (ventaNorm.detalles || [])
    .map(
      (d) => `
      <div class="line">
        <span>${esc(d.cantidad)}× ${esc(d.nombre)}</span>
        <span>${esc(money(d.subtotal))}</span>
      </div>
      ${d.notas ? `<div class="notas">${esc(d.notas)}</div>` : ""}`
    )
    .join("");

  const delivery =
    ventaNorm.tipo_entrega === "delivery" && ventaNorm.cobro_delivery
      ? `<div class="line"><span>Delivery</span><span>${esc(money(ventaNorm.cobro_delivery))}</span></div>`
      : "";

  const nombresPago = {
    efectivo: "Efectivo",
    debito: "Débito",
    credito: "Crédito",
    transferencia: "Transferencia",
    webpay: "Webpay",
    tarjeta: "Tarjeta",
  };

  const pagos = (ventaNorm.pagos || []).filter(
    (p) => Number(p.monto) > 0
  );

  const detallePagos = pagos.length
    ? pagos
        .map(
          (p) => `
          <div class="line">
            <span>${esc(nombresPago[p.metodo] || p.metodo)}</span>
            <span>${esc(money(p.monto))}</span>
          </div>`
        )
        .join("")
    : `
      <div class="line">
        <span>${esc(
          nombresPago[ventaNorm.metodo_pago] ||
          ventaNorm.metodo_pago ||
          "No informado"
        )}</span>
        <span>${esc(money(ventaNorm.total))}</span>
      </div>`;

  const body = `
    <h1>el Tenedor</h1>
    <p class="sub">General del Canto · Restaurante para llevar</p>
    <p class="banner">COMPROBANTE DE VENTA</p>

    <div class="meta">
      <div><strong>Venta #${esc(ventaNorm.id)}</strong></div>
      <div>Fecha: ${esc(fechaLocal(ventaNorm.fecha_hora))}</div>
      <div>Entrega: ${esc(ventaNorm.tipo_entrega)}</div>
      ${(ventaNorm.cliente_nombre || ventaNorm.cliente)
        ? `<div>Cliente: ${esc(ventaNorm.cliente_nombre || ventaNorm.cliente)}</div>`
        : ""
      }
      ${ventaNorm.cajero ? `<div>Cajero: ${esc(ventaNorm.cajero)}</div>` : ""}
      ${ventaNorm.notas ? `<div><strong>Nota:</strong> ${esc(ventaNorm.notas)}</div>` : ""}
    </div>

    <hr />

    ${lineas || "<p>Sin ítems</p>"}
    ${delivery}

    <hr />
    <div class="line">
      <span>Monto neto</span>
      <span>${esc(money(impuestos.neto))}</span>
    </div>

    <div class="line">
      <span>IVA 19% incluido</span>
      <span>${esc(money(impuestos.iva))}</span>
    </div>

    <hr />

    <div class="total">
      <span>TOTAL</span>
      <span>${esc(money(impuestos.total))}</span>
    </div>

    <hr />

    <div class="meta">
      <strong>FORMA DE PAGO</strong>
    </div>

    ${detallePagos}

    <p class="sub" style="margin-top:14px">
      IVA incluido en el precio final
    </p>

    <p class="sub">
      ¡Gracias por su compra!
    </p>
    <p class="sub" style="margin-top:6px; font-size:11px;">📍 Calle General Estanislao del Canto 326, General del Canto, Punta Arenas</p>
    <p class="sub" style="margin-top:2px; font-size:11px;">📱 WhatsApp: +56 9 54332805</p>
  `;

  return escribirImpresion(
    documentoHtml(`Comprobante #${ventaNorm.id}`, body),
    win
  );
}
export function imprimirComandaCocina(ventaNorm, win = null) {
  const lineas = (ventaNorm.detalles || [])
    .map(
      (d) => `
      <div class="line"><strong>${esc(d.cantidad)}× ${esc(d.nombre)}</strong></div>
      ${d.notas ? `<div class="notas">→ ${esc(d.notas)}</div>` : ""}`
    )
    .join("");

  const body = `
    <p class="banner">COCINA / PREPARACIÓN</p>
    <h1>el Tenedor</h1>
    <div class="meta">
      <div><strong>Pedido #${esc(ventaNorm.id)}</strong></div>
      <div>${esc(fechaLocal(ventaNorm.fecha_hora))}</div>
      <div>${esc(ventaNorm.tipo_entrega).toUpperCase()}</div>
      ${ventaNorm.notas ? `<div><strong>NOTA PEDIDO:</strong> ${esc(ventaNorm.notas)}</div>` : ""}
    </div>
    <hr />
    ${lineas || "<p>Sin ítems</p>"}
    <hr />
    <p class="sub">Sin precios — solo preparación</p>
  `;

  return escribirImpresion(documentoHtml(`Cocina #${ventaNorm.id}`, body), win);
}

/** Abrir ambas ventanas en el mismo clic del usuario (evita bloqueo del navegador). */
export function prepararVentanasImpresion() {
  // Sin noopener: necesitamos la referencia para escribir el HTML después del cobro
  const ticket = window.open("", "_blank", "width=400,height=640");
  const cocina = window.open("", "_blank", "width=400,height=640");
  return { ticket, cocina };
}

export function cerrarVentanasImpresion(ventanas) {
  try {
    ventanas?.ticket?.close?.();
  } catch {
    /* ignore */
  }
  try {
    ventanas?.cocina?.close?.();
  } catch {
    /* ignore */
  }
}

/** Imprime ticket cliente + comanda cocina. Usá `ventanas` si ya se abrieron al inicio del cobro. */
export function imprimirTicketYCocina(ventaNorm, ventanas = null) {
  const wins = ventanas || prepararVentanasImpresion();
  const okTicket = imprimirTicketCliente(ventaNorm, wins.ticket);
  const okCocina = imprimirComandaCocina(ventaNorm, wins.cocina);
  return okTicket && okCocina;
}

function escribirImpresion(html, win = null) {
  const w = win || window.open("", "_blank", "width=400,height=640");
  if (!w) {
    return false;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
