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

  try {
    // POST /pedido
    if (req.method === "POST" && req.url === "/pedido") {
      const body = await leerCuerpo(req);
      const { tipoServicio, subtipo, detalles, origen, destino } = body;

      if (!tipoServicio || !origen || !destino) {
        return enviarJSON(res, 400, {
          error: "Faltan datos: tipoServicio, origen y destino son requeridos",
        });
      }

      const tarifa = calcularTarifa(tipoServicio, origen, destino);
      const asignacion = await asignarConductor(origen);

      let pedido = null;
      if (asignacion.asignado) {
        await conductoresStore.marcarOcupado(asignacion.conductor.id);
        pedido = await pedidosStore.crear({
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
    }

    // POST /conductor/registrar
    if (req.method === "POST" && req.url === "/conductor/registrar") {
      const body = await leerCuerpo(req);
      const { id, nombre, telefono } = body;
      if (!id || !nombre) {
        return enviarJSON(res, 400, { error: "Faltan datos: id y nombre son requeridos" });
      }
      const conductor = await conductoresStore.registrar({ id, nombre, telefono });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/ubicacion
    if (
      req.method === "POST" &&
      partes[0] === "conductor" &&
      partes[2] === "ubicacion"
    ) {
      const body = await leerCuerpo(req);
      const { lat, lng } = body;
      const conductor = await conductoresStore.actualizarUbicacion(partes[1], lat, lng);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/estado  { enLinea: true|false }
    if (
      req.method === "POST" &&
      partes[0] === "conductor" &&
      partes[2] === "estado"
    ) {
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.marcarEnLinea(partes[1], !!body.enLinea);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      if (conductor._bloqueado) {
        return enviarJSON(res, 403, {
          error: "No puedes ponerte en línea: tus documentos todavía no han sido aprobados",
        });
      }
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/documentos
    if (
      req.method === "POST" &&
      partes[0] === "conductor" &&
      partes[2] === "documentos"
    ) {
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.guardarDocumentos(partes[1], body);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/verificar  { aprobado: true|false }
    if (
      req.method === "POST" &&
      partes[0] === "conductor" &&
      partes[2] === "verificar"
    ) {
      const body = await leerCuerpo(req);
      const estado = body.aprobado ? "aprobado" : "rechazado";
      const conductor = await conductoresStore.actualizarVerificacion(partes[1], estado);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // GET /conductor/:id — perfil completo
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes.length === 2
    ) {
      const conductor = await conductoresStore.obtener(partes[1]);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // GET /conductor/:id/pedido-pendiente
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "pedido-pendiente"
    ) {
      const pedido = await pedidosStore.obtenerPendientePorConductor(partes[1]);
      return enviarJSON(res, 200, { pedido });
    }

    // POST /pedido/:id/confirmar
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "confirmar"
    ) {
      const pedido = await pedidosStore.actualizarEstado(partes[1], "confirmado");
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      return enviarJSON(res, 200, { pedido });
    }

    // POST /pedido/:id/rechazar
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "rechazar"
    ) {
      const pedido = await pedidosStore.actualizarEstado(partes[1], "rechazado");
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      await conductoresStore.marcarDisponible(pedido.conductorId);
      return enviarJSON(res, 200, { pedido });
    }

    // POST /pedido/:id/completar
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "completar"
    ) {
      const pedido = await pedidosStore.actualizarEstado(partes[1], "completado");
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      await conductoresStore.marcarDisponible(pedido.conductorId);
      return enviarJSON(res, 200, { pedido });
    }

    // GET /conductores
    if (req.method === "GET" && req.url === "/conductores") {
      return enviarJSON(res, 200, await conductoresStore.todos());
    }

    enviarJSON(res, 404, { error: "Ruta no encontrada" });
  } catch (err) {
    console.error(err);
    enviarJSON(res, 500, { error: "Error interno del servidor: " + err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor MVP corriendo en http://localhost:${PORT}`);
});
