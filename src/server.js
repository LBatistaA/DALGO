const http = require("http");
const { calcularTarifa } = require("./services/fareService");
const { buscarCandidatos } = require("./services/dispatchService");
const { distanciaKm } = require("./utils/geo");
const conductoresStore = require("./data/conductoresStore");
const pedidosStore = require("./data/pedidosStore");
const usuariosStore = require("./data/usuariosStore");
const fareConfig = require("./config/fareConfig");

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
    tieneFotoPerfil: !!c.tieneFotoPerfil,
    calificacionPromedio:
      c.calificacionCantidad > 0
        ? Number((c.calificacionTotal / c.calificacionCantidad).toFixed(1))
        : null,
  };
}

const server = http.createServer(async (req, res) => {
  const partes = segmentos(req.url);

  try {
    // POST /cotizar
    // Calcula el precio para "carro" y "moto" a la vez, SIN buscar
    // conductor todavía — para mostrar ambas opciones con su precio
    // antes de que el usuario elija y pida.
    if (req.method === "POST" && req.url === "/cotizar") {
      const body = await leerCuerpo(req);
      const { origen, destino } = body;
      if (!origen || !destino) {
        return enviarJSON(res, 400, { error: "Faltan datos: origen y destino son requeridos" });
      }
      const carro = calcularTarifa("carrera", origen, destino, "carro");
      const moto = calcularTarifa("carrera", origen, destino, "moto");
      return enviarJSON(res, 200, { carro, moto });
    }

    // POST /pedido
    // Calcula tarifa y busca hasta 10 conductores candidatos cercanos
    // del tipo de vehículo pedido — el pedido queda "buscando_conductor"
    // hasta que alguno de ellos lo acepte.
    if (req.method === "POST" && req.url.startsWith("/pedido") && partes.length === 1) {
      const body = await leerCuerpo(req);
      const { tipoServicio, subtipo, detalles, origen, destino, tipoVehiculo, usuarioId } = body;

      if (!tipoServicio || !origen || !destino) {
        return enviarJSON(res, 400, {
          error: "Faltan datos: tipoServicio, origen y destino son requeridos",
        });
      }

      const tarifa = calcularTarifa(tipoServicio, origen, destino, tipoVehiculo);
      const candidatos = await buscarCandidatos(origen, tipoVehiculo || null, tipoServicio);

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
        usuarioId,
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

    // GET /conductor/:id/resumen
    // Ganancias de hoy, cuántos servicios completó hoy, y su actividad
    // más reciente — para la pantalla de Inicio del conductor.
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "resumen"
    ) {
      const historial = await pedidosStore.obtenerPorConductor(partes[1]);
      const hoy = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

      const completadosHoy = historial.filter(
        (p) => p.estado === "completado" && p.creadoEn.slice(0, 10) === hoy
      );
      const gananciasHoy = completadosHoy.reduce(
        (suma, p) => suma + (p.tarifa?.tarifa || 0),
        0
      );

      return enviarJSON(res, 200, {
        gananciasHoy: Number(gananciasHoy.toFixed(2)),
        serviciosCompletadosHoy: completadosHoy.length,
        actividadReciente: historial
          .filter((p) => p.estado === "completado")
          .slice(0, 10),
      });
    }

    // GET /conductor/:id/historial — todos sus pedidos, para la
    // pantalla "Mis viajes"
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "historial"
    ) {
      const historial = await pedidosStore.obtenerPorConductor(partes[1]);
      return enviarJSON(res, 200, { historial });
    }

    // GET /conductor/:id/ganancias — totales de hoy, esta semana y este
    // mes, para la pantalla "Ganancias"
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "ganancias"
    ) {
      const historial = await pedidosStore.obtenerPorConductor(partes[1]);
      const completados = historial.filter((p) => p.estado === "completado");

      const ahora = new Date();
      const hoyStr = ahora.toISOString().slice(0, 10);
      const mesStr = ahora.toISOString().slice(0, 7);
      const haceUnaSemana = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);

      const calcular = (lista) => ({
        monto: Number(
          lista.reduce((s, p) => s + (p.tarifa?.tarifa || 0), 0).toFixed(2)
        ),
        cantidad: lista.length,
      });

      const deHoy = completados.filter((p) => p.creadoEn.slice(0, 10) === hoyStr);
      const deEstaSemana = completados.filter(
        (p) => new Date(p.creadoEn) >= haceUnaSemana
      );
      const deEsteMes = completados.filter((p) => p.creadoEn.slice(0, 7) === mesStr);

      return enviarJSON(res, 200, {
        hoy: calcular(deHoy),
        semana: calcular(deEstaSemana),
        mes: calcular(deEsteMes),
      });
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

    // GET /conductor/:id/pedidos-pendientes — TODOS los pedidos donde
    // este conductor es candidato (puede ser más de uno a la vez)
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "pedidos-pendientes"
    ) {
      const pedidos = await pedidosStore.obtenerPendientesPorConductor(partes[1]);
      return enviarJSON(res, 200, { pedidos });
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

    // POST /pedido/:id/iniciar-servicio
    // El conductor llegó al punto de encuentro — pasa de "confirmado"
    // (en camino) a "en_servicio" (viaje en curso).
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "iniciar-servicio"
    ) {
      const pedido = await pedidosStore.actualizarEstado(partes[1], "en_servicio");
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      return enviarJSON(res, 200, { pedido });
    }

    // POST /pedido/:id/completar
    // El body puede incluir { estrellas: 1-5 } — la calificación que el
    // conductor le da al usuario.
    if (req.method === "POST" && partes[0] === "pedido" && partes[2] === "completar") {
      const body = await leerCuerpo(req);
      const pedido = await pedidosStore.actualizarEstado(partes[1], "completado");
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      await conductoresStore.marcarDisponible(pedido.conductorId);

      let usuario = null;
      if (pedido.usuarioId) {
        usuario = await usuariosStore.agregarMoviCoins(
          pedido.usuarioId,
          fareConfig.moviCoinsPorViaje
        );
        if (body.estrellas) {
          usuario = await usuariosStore.agregarCalificacion(
            pedido.usuarioId,
            Number(body.estrellas)
          );
        }
      }

      return enviarJSON(res, 200, { pedido, usuario });
    }

    // POST /conductor/:id/pausa  { pausado: true|false }
    // "Descansando" — sigue en línea pero no le llegan pedidos nuevos.
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "pausa") {
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.marcarPausado(partes[1], !!body.pausado);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/servicios  { carrera: true|false, delivery: true|false }
    if (
      req.method === "POST" &&
      partes[0] === "conductor" &&
      partes[2] === "servicios"
    ) {
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.actualizarServicios(partes[1], {
        carrera: body.carrera !== false,
        delivery: body.delivery !== false,
      });
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /pedido/:id/calificar-conductor  { estrellas: 1-5 }
    // El usuario califica al conductor, después de que el viaje se
    // completó (distinto del rating que el conductor le da al usuario).
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "calificar-conductor"
    ) {
      const body = await leerCuerpo(req);
      const pedido = await pedidosStore.obtenerPorId(partes[1]);
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      if (!pedido.conductorId) {
        return enviarJSON(res, 400, { error: "Este pedido no tiene conductor asignado" });
      }
      const conductor = await conductoresStore.agregarCalificacion(
        pedido.conductorId,
        Number(body.estrellas)
      );
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/foto-perfil  { fotoPerfil: "data:image/..." }
    if (
      req.method === "POST" &&
      partes[0] === "conductor" &&
      partes[2] === "foto-perfil"
    ) {
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.guardarFotoPerfil(
        partes[1],
        body.fotoPerfil
      );
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // GET /conductor/:id/foto-perfil
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "foto-perfil"
    ) {
      const fotoPerfil = await conductoresStore.obtenerFotoPerfil(partes[1]);
      return enviarJSON(res, 200, { fotoPerfil });
    }

    // POST /conductor/:id/zona  { zona: "Maracay, Aragua" }
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "zona") {
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.actualizarZona(partes[1], body.zona || null);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /usuario/registrar
    if (req.method === "POST" && req.url === "/usuario/registrar") {
      const body = await leerCuerpo(req);
      const { id, nombre } = body;
      if (!id) return enviarJSON(res, 400, { error: "Falta id" });
      const usuario = await usuariosStore.registrar({ id, nombre });
      return enviarJSON(res, 200, { usuario });
    }

    // GET /usuario/:id
    if (req.method === "GET" && partes[0] === "usuario" && partes.length === 2) {
      const usuario = await usuariosStore.obtener(partes[1]);
      if (!usuario) return enviarJSON(res, 404, { error: "Usuario no registrado" });
      return enviarJSON(res, 200, { usuario });
    }

    // GET /tasa-bcv — tasa oficial del dólar (BCV), para mostrar el
    // total también en bolívares en el resumen del viaje.
    if (req.method === "GET" && req.url === "/tasa-bcv") {
      try {
        const respuesta = await fetch("https://bcv.today/api/v1/rate.json");
        const datos = await respuesta.json();
        return enviarJSON(res, 200, {
          tasa: datos.USD,
          fecha: datos.effective_date || datos.date || null,
        });
      } catch (err) {
        // Si la fuente externa falla, devolvemos un valor de respaldo
        // fijo — así el resumen del viaje nunca se rompe por esto.
        // Actualízalo de vez en cuando si queda muy desfasado.
        return enviarJSON(res, 200, {
          tasa: 773.31,
          fecha: null,
          respaldo: true,
        });
      }
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
