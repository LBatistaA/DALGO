const http = require("http");
const { calcularTarifa } = require("./services/fareService");
const { buscarCandidatos } = require("./services/dispatchService");
const { distanciaKm } = require("./utils/geo");
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

function segmentos(url) {
  return url.split("?")[0].split("/").filter(Boolean);
}

function query(url) {
  const idx = url.indexOf("?");
  return idx === -1 ? {} : Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
}

// Solo los datos públicos del conductor — nunca sus documentos completos
function infoPublicaConductor(c) {
  if (!c) return null;
  return {
    id: c.id,
    nombre: c.nombre,
    telefono: c.telefono,
    placa: c.placa,
    colorVehiculo: c.colorVehiculo,
    tipoVehiculo: c.tipoVehiculo,
  };
}

const server = http.createServer(async (req, res) => {
  const partes = segmentos(req.url);

  try {
    // POST /pedido
    // Calcula tarifa y busca hasta 10 conductores candidatos cercanos
    // del tipo de vehículo pedido — el pedido queda "buscando_conductor"
    // hasta que alguno de ellos lo acepte.
    if (req.method === "POST" && req.url.startsWith("/pedido") && partes.length === 1) {
      const body = await leerCuerpo(req);
      const { tipoServicio, subtipo, detalles, origen, destino, tipoVehiculo } = body;

      if (!tipoServicio || !origen || !destino) {
        return enviarJSON(res, 400, {
          error: "Faltan datos: tipoServicio, origen y destino son requeridos",
        });
      }

      const tarifa = calcularTarifa(tipoServicio, origen, destino);
      const candidatos = await buscarCandidatos(origen, tipoVehiculo || null);

      if (candidatos.length === 0) {
        return enviarJSON(res, 200, {
          pedido: null,
          tarifa,
          asignacion: { asignado: false, motivo: "No hay conductores disponibles" },
        });
      }

      const pedido = await pedidosStore.crear({
        tipoServicio,
        subtipo,
        detalles,
        origen,
        destino,
        tarifa,
        tipoVehiculo: tipoVehiculo || null,
        candidatos: candidatos.map((c) => c.id),
      });

      return enviarJSON(res, 200, {
        pedido,
        tarifa,
        asignacion: { asignado: true, buscando: true, candidatos: candidatos.length },
      });
    }

    // GET /pedido/:id — estado actual, y si ya hay conductor asignado,
    // sus datos públicos (para que el cliente los muestre: nombre,
    // placa, color, teléfono).
    if (req.method === "GET" && partes[0] === "pedido" && partes.length === 2) {
      const pedido = await pedidosStore.obtenerPorId(partes[1]);
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      const conductor = pedido.conductorId
        ? infoPublicaConductor(await conductoresStore.obtener(pedido.conductorId))
        : null;
      return enviarJSON(res, 200, { pedido, conductor });
    }

    // GET /conductores/cercanos?lat=&lng=&tipoVehiculo=
    // Lista liviana (id, ubicación, tipo) para mostrar en el mapa del
    // cliente los conductores disponibles cerca, antes de pedir.
    if (req.method === "GET" && req.url.startsWith("/conductores/cercanos")) {
      const q = query(req.url);
      const lat = parseFloat(q.lat);
      const lng = parseFloat(q.lng);
      const disponibles = await conductoresStore.disponibles(q.tipoVehiculo || null);
      const lista = disponibles.map((c) => ({
        id: c.id,
        lat: c.lat,
        lng: c.lng,
        tipoVehiculo: c.tipoVehiculo,
        distanciaKm:
          !isNaN(lat) && !isNaN(lng)
            ? Number(distanciaKm({ lat, lng }, { lat: c.lat, lng: c.lng }).toFixed(2))
            : null,
      }));
      return enviarJSON(res, 200, lista);
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
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "ubicacion") {
      const body = await leerCuerpo(req);
      const { lat, lng } = body;
      const conductor = await conductoresStore.actualizarUbicacion(partes[1], lat, lng);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/estado
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "estado") {
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
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "documentos") {
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.guardarDocumentos(partes[1], body);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/verificar
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "verificar") {
      const body = await leerCuerpo(req);
      const estado = body.aprobado ? "aprobado" : "rechazado";
      const conductor = await conductoresStore.actualizarVerificacion(partes[1], estado);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // GET /conductor/:id
    if (req.method === "GET" && partes[0] === "conductor" && partes.length === 2) {
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

    // POST /pedido/:id/confirmar/:conductorId
    // El conductor intenta aceptar. Si otro ya se lo ganó, se lo decimos.
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "confirmar"
    ) {
      const conductorId = partes[3];
      if (!conductorId) {
        return enviarJSON(res, 400, { error: "Falta el ID del conductor en la ruta" });
      }
      const resultado = await pedidosStore.intentarConfirmar(partes[1], conductorId);
      if (!resultado.exito) {
        return enviarJSON(res, 409, {
          error:
            resultado.motivo === "ya_tomado"
              ? "Otro conductor ya aceptó este pedido"
              : "No se pudo confirmar el pedido",
          motivo: resultado.motivo,
        });
      }
      await conductoresStore.marcarOcupado(conductorId);
      return enviarJSON(res, 200, { pedido: resultado.pedido });
    }

    // POST /pedido/:id/rechazar/:conductorId
    // Este conductor específico descarta el pedido — sigue disponible
    // para los demás candidatos.
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "rechazar"
    ) {
      const conductorId = partes[3];
      if (!conductorId) {
        return enviarJSON(res, 400, { error: "Falta el ID del conductor en la ruta" });
      }
      const pedido = await pedidosStore.descartarParaConductor(partes[1], conductorId);
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      return enviarJSON(res, 200, { pedido });
    }

    // POST /pedido/:id/completar
    if (req.method === "POST" && partes[0] === "pedido" && partes[2] === "completar") {
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
