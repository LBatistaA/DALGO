const http = require("http");
const { calcularTarifa } = require("./services/fareService");
const { asignarConductor } = require("./services/dispatchService");
const conductoresStore = require("./data/conductoresStore");
const pedidosStore = require("./data/pedidosStore");

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function enviarJSON(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

// Extrae un segmento de la URL, ej: /pedido/123/confirmar -> ["pedido","123","confirmar"]
function segmentos(url) {
  return url.split("?")[0].split("/").filter(Boolean);
}

const server = http.createServer(async (req, res) => {
  const partes = segmentos(req.url);

  // POST /pedido
  // Calcula tarifa, asigna conductor real disponible más cercano, y crea
  // el pedido en estado "pendiente_confirmacion" — el conductor todavía
  // tiene que aceptarlo desde su app.
  if (req.method === "POST" && req.url === "/pedido") {
    try {
      const body = await leerCuerpo(req);
      const { tipoServicio, subtipo, detalles, origen, destino } = body;

      if (!tipoServicio || !origen || !destino) {
        return enviarJSON(res, 400, {
          error: "Faltan datos: tipoServicio, origen y destino son requeridos",
        });
      }

      const tarifa = calcularTarifa(tipoServicio, origen, destino);
      const asignacion = asignarConductor(origen);

      let pedido = null;
      if (asignacion.asignado) {
        conductoresStore.marcarOcupado(asignacion.conductor.id);
        pedido = pedidosStore.crear({
          tipoServicio,
          subtipo,
          detalles,
          origen,
          destino,
          tarifa,
          conductorId: asignacion.conductor.id,
        });
      }

      return enviarJSON(res, 200, { pedido, tarifa, asignacion });
    } catch (err) {
      return enviarJSON(res, 400, { error: err.message });
    }
  }

  // POST /conductor/registrar
  // La app del conductor llama esto justo después de iniciar sesión (o al
  // activar "en línea" por primera vez), para crear/actualizar su perfil.
  if (req.method === "POST" && req.url === "/conductor/registrar") {
    try {
      const body = await leerCuerpo(req);
      const { id, nombre, telefono } = body;
      if (!id || !nombre) {
        return enviarJSON(res, 400, { error: "Faltan datos: id y nombre son requeridos" });
      }
      const conductor = conductoresStore.registrar({ id, nombre, telefono });
      return enviarJSON(res, 200, { conductor });
    } catch (err) {
      return enviarJSON(res, 400, { error: err.message });
    }
  }

  // POST /conductor/:id/ubicacion
  // La app del conductor manda esto cada cierto tiempo mientras está en
  // línea, para que el sistema sepa dónde está.
  if (
    req.method === "POST" &&
    partes[0] === "conductor" &&
    partes[2] === "ubicacion"
  ) {
    try {
      const body = await leerCuerpo(req);
      const { lat, lng } = body;
      const conductor = conductoresStore.actualizarUbicacion(partes[1], lat, lng);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    } catch (err) {
      return enviarJSON(res, 400, { error: err.message });
    }
  }

  // POST /conductor/:id/estado  { enLinea: true|false }
  if (
    req.method === "POST" &&
    partes[0] === "conductor" &&
    partes[2] === "estado"
  ) {
    try {
      const body = await leerCuerpo(req);
      const conductor = conductoresStore.marcarEnLinea(partes[1], !!body.enLinea);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      if (conductor._bloqueado) {
        return enviarJSON(res, 403, {
          error: "No puedes ponerte en línea: tus documentos todavía no han sido aprobados",
        });
      }
      return enviarJSON(res, 200, { conductor });
    } catch (err) {
      return enviarJSON(res, 400, { error: err.message });
    }
  }

  // POST /conductor/:id/documentos
  // El conductor sube (o actualiza) su placa y las URLs de sus documentos
  // ya subidos a Firebase Storage. Queda en revisión hasta que alguien
  // lo apruebe con /conductor/:id/verificar.
  if (
    req.method === "POST" &&
    partes[0] === "conductor" &&
    partes[2] === "documentos"
  ) {
    try {
      const body = await leerCuerpo(req);
      const conductor = conductoresStore.guardarDocumentos(partes[1], body);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    } catch (err) {
      return enviarJSON(res, 400, { error: err.message });
    }
  }

  // POST /conductor/:id/verificar  { aprobado: true|false }
  // Por ahora esto lo llama Dalgo/Luis manualmente (con curl o Postman)
  // mientras no existe un panel administrativo — sirve para aprobar o
  // rechazar los documentos de un conductor.
  if (
    req.method === "POST" &&
    partes[0] === "conductor" &&
    partes[2] === "verificar"
  ) {
    try {
      const body = await leerCuerpo(req);
      const estado = body.aprobado ? "aprobado" : "rechazado";
      const conductor = conductoresStore.actualizarVerificacion(partes[1], estado);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    } catch (err) {
      return enviarJSON(res, 400, { error: err.message });
    }
  }

  // GET /conductor/:id — perfil completo, para que la app sepa su
  // estado de verificación al abrir
  if (
    req.method === "GET" &&
    partes[0] === "conductor" &&
    partes.length === 2
  ) {
    const conductor = conductoresStore.obtener(partes[1]);
    if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
    return enviarJSON(res, 200, { conductor });
  }

  // GET /conductor/:id/pedido-pendiente
  // El conductor consulta (cada pocos segundos) si tiene un pedido nuevo
  // esperando su confirmación.
  if (
    req.method === "GET" &&
    partes[0] === "conductor" &&
    partes[2] === "pedido-pendiente"
  ) {
    const conductorId = partes[1];
    const pedido = pedidosStore.obtenerPendientePorConductor(conductorId);
    return enviarJSON(res, 200, { pedido });
  }

  // POST /pedido/:id/confirmar
  if (
    req.method === "POST" &&
    partes[0] === "pedido" &&
    partes[2] === "confirmar"
  ) {
    const pedido = pedidosStore.actualizarEstado(partes[1], "confirmado");
    if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
    return enviarJSON(res, 200, { pedido });
  }

  // POST /pedido/:id/rechazar
  // El conductor lo rechaza: el pedido queda marcado, y lo liberamos para
  // que vuelva a estar disponible (en un sistema real, aquí se reintentaría
  // asignar al siguiente conductor más cercano).
  if (
    req.method === "POST" &&
    partes[0] === "pedido" &&
    partes[2] === "rechazar"
  ) {
    const pedido = pedidosStore.actualizarEstado(partes[1], "rechazado");
    if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
    conductoresStore.marcarDisponible(pedido.conductorId);
    return enviarJSON(res, 200, { pedido });
  }

  // POST /pedido/:id/completar
  // El conductor marca el viaje/entrega como terminado — libera al
  // conductor para que le puedan asignar otro pedido.
  if (
    req.method === "POST" &&
    partes[0] === "pedido" &&
    partes[2] === "completar"
  ) {
    const pedido = pedidosStore.actualizarEstado(partes[1], "completado");
    if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
    conductoresStore.marcarDisponible(pedido.conductorId);
    return enviarJSON(res, 200, { pedido });
  }

  // GET /conductores — ver el estado de todos los conductores registrados
  if (req.method === "GET" && req.url === "/conductores") {
    return enviarJSON(res, 200, conductoresStore.todos());
  }

  enviarJSON(res, 404, { error: "Ruta no encontrada" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor MVP corriendo en http://localhost:${PORT}`);
});
