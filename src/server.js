const http = require("http");
const { calcularTarifa } = require("./services/fareService");
const { asignarConductor } = require("./services/dispatchService");
const mockDrivers = require("./data/mockDrivers");

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

const server = http.createServer(async (req, res) => {
  // POST /pedido
  // Recibe origen, destino y tipo de servicio.
  // Devuelve la tarifa calculada Y el conductor asignado en una sola llamada,
  // que es justo el flujo que hoy le toma ~30 min a Dalgo hacer a mano.
  if (req.method === "POST" && req.url === "/pedido") {
    try {
      const body = await leerCuerpo(req);
      const { tipoServicio, origen, destino } = body;

      if (!tipoServicio || !origen || !destino) {
        return enviarJSON(res, 400, {
          error: "Faltan datos: tipoServicio, origen y destino son requeridos",
        });
      }

      const tarifa = calcularTarifa(tipoServicio, origen, destino);
      const asignacion = asignarConductor(origen);

      if (asignacion.asignado) {
        mockDrivers.marcarOcupado(asignacion.conductor.id);
      }

      return enviarJSON(res, 200, { tarifa, asignacion });
    } catch (err) {
      return enviarJSON(res, 400, { error: err.message });
    }
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
