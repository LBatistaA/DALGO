const http = require("http");
const { calcularTarifa } = require("./services/fareService");
const { asignarConductor } = require("./services/dispatchService");
const mockDrivers = require("./data/mockDrivers");
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
  // Calcula tarifa, asigna conductor, y crea el pedido en estado
  // "pendiente_confirmacion" — el conductor todavía tiene que aceptarlo.
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
        mockDrivers.marcarOcupado(asignacion.conductor.id);
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
    mockDrivers.marcarDisponible(pedido.conductorId);
    return enviarJSON(res, 200, { pedido });
  }

  // GET /conductores — para ver el estado de los conductores de prueba
  if (req.method === "GET" && req.url === "/conductores") {
    return enviarJSON(res, 200, mockDrivers.todos());
  }

  enviarJSON(res, 404, { error: "Ruta no encontrada" });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor MVP corriendo en http://localhost:${PORT}`);
});
