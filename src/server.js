const http = require("http");
const fs = require("fs");
const path = require("path");
const { calcularTarifa } = require("./services/fareService");
const { buscarCandidatos } = require("./services/dispatchService");
const { distanciaKm } = require("./utils/geo");
const conductoresStore = require("./data/conductoresStore");
const pedidosStore = require("./data/pedidosStore");
const usuariosStore = require("./data/usuariosStore");
const restaurantesStore = require("./data/restaurantesStore");
const fareConfig = require("./config/fareConfig");
const { auth } = require("./firebaseAdmin");

// Se lee una sola vez al arrancar — no en cada visita al panel, para
// no leer el disco de más en cada petición.
const HTML_PANEL_ADMIN = fs.readFileSync(
  path.join(__dirname, "admin", "index.html"),
  "utf-8"
);

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
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret",
  });
  res.end(JSON.stringify(payload));
}

function segmentos(url) {
  return url.split("?")[0].split("/").filter(Boolean);
}

function query(url) {
  const idx = url.indexOf("?");
  return idx === -1 ? {} : Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
}

// Verifica el token de Firebase que manda el cliente en el encabezado
// "Authorization: Bearer <token>". Si es válido, devuelve el uid REAL
// del usuario autenticado — nunca hay que confiar en un id que venga
// suelto en la URL o en el body, porque cualquiera podría inventarlo.
async function verificarToken(req) {
  const encabezado = req.headers["authorization"] || req.headers["Authorization"];
  if (!encabezado || !encabezado.startsWith("Bearer ")) return null;
  const idToken = encabezado.slice(7).trim();
  if (!idToken) return null;
  try {
    const decodificado = await auth.verifyIdToken(idToken);
    return decodificado.uid;
  } catch (err) {
    return null;
  }
}

// Para las pocas rutas de administrador (aprobar conductores, ver todo
// el sistema) — mientras no exista un sistema de roles de verdad, se
// protegen con una clave secreta aparte del login normal. Hay que
// configurar ADMIN_SECRET como variable de entorno en Render.
function esAdmin(req) {
  const secreto = process.env.ADMIN_SECRET;
  if (!secreto) return false; // sin la variable configurada, nadie pasa
  const recibido = req.headers["x-admin-secret"] || req.headers["X-Admin-Secret"];
  return recibido === secreto;
}

function noAutorizado(res, mensaje) {
  enviarJSON(res, 401, { error: mensaje || "No autorizado — falta iniciar sesión" });
}

function prohibido(res, mensaje) {
  enviarJSON(res, 403, { error: mensaje || "No tienes permiso para hacer esto" });
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

function infoPublicaUsuario(u) {
  if (!u) return null;
  return {
    id: u.id,
    nombre: u.nombre,
    telefono: u.telefono,
    tieneFotoPerfil: !!u.tieneFotoPerfil,
  };
}

const server = http.createServer(async (req, res) => {
  const partes = segmentos(req.url);

  // El navegador manda esta petición "de prueba" antes de la real,
  // cuando la página que llama vive en otro origen (ej. el panel de
  // administrador abierto como archivo local) — solo hay que
  // responder que sí se permite, sin ejecutar ninguna ruta.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Secret",
    });
    return res.end();
  }

  // GET /admin — sirve el panel de administrador como página web,
  // en vez de tener que abrir un archivo local.
  if (req.method === "GET" && req.url === "/admin") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(HTML_PANEL_ADMIN);
  }

  try {
    // POST /cotizar
    if (req.method === "POST" && req.url === "/cotizar") {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const body = await leerCuerpo(req);
      const { origen, destino, tipoServicio } = body;
      if (!origen || !destino) {
        return enviarJSON(res, 400, { error: "Faltan datos: origen y destino son requeridos" });
      }
      if (tipoServicio === "delivery") {
        const delivery = calcularTarifa("delivery", origen, destino);
        return enviarJSON(res, 200, { delivery });
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
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const body = await leerCuerpo(req);
      const {
        tipoServicio,
        subtipo,
        detalles,
        origen,
        destino,
        tipoVehiculo,
        usuarioId,
        nombreCliente,
        telefonoCliente,
        codigoCliente,
        numeroTracking,
      } = body;

      // Si viene un número de tracking, es el Aliado "recogiendo" un
      // pedido que su cliente ya dejó en estado "procesando" después
      // de hablar por WhatsApp — se busca ese pedido y se avanza a
      // buscar conductor, en vez de crear uno nuevo desde cero.
      if (numeroTracking) {
        const pedidoExistente = await pedidosStore.buscarPorTracking(numeroTracking);
        if (!pedidoExistente) {
          return enviarJSON(res, 404, {
            error: "No se encontró ningún pedido con ese número de tracking",
          });
        }
        if (pedidoExistente.estado !== "procesando") {
          return enviarJSON(res, 400, {
            error: "Este pedido ya fue procesado antes",
          });
        }
        // Verificación extra: si además dan el código del cliente,
        // debe coincidir con el dueño real de ese número de tracking
        // — evita que alguien "adivine" un tracking y lo tome.
        if (codigoCliente) {
          const clienteReal = await usuariosStore.obtener(pedidoExistente.usuarioId);
          if (clienteReal?.codigoCliente !== codigoCliente.toUpperCase().trim()) {
            return prohibido(res, "El código no coincide con este número de tracking");
          }
        }
        const tarifaCalculada = calcularTarifa(
          "delivery",
          pedidoExistente.origen,
          pedidoExistente.destino
        );
        const candidatosEncontrados = await buscarCandidatos(
          pedidoExistente.origen,
          null,
          "delivery"
        );
        if (candidatosEncontrados.length === 0) {
          return enviarJSON(res, 200, {
            pedido: null,
            tarifa: tarifaCalculada,
            asignacion: { asignado: false, motivo: "No hay conductores disponibles" },
          });
        }
        const actualizado = await pedidosStore.avanzarAProcesarBusqueda(pedidoExistente.id, {
          tarifa: tarifaCalculada,
          candidatos: candidatosEncontrados.map((c) => c.id),
          creadoPorId: uid,
        });
        return enviarJSON(res, 200, {
          pedido: actualizado,
          tarifa: tarifaCalculada,
          asignacion: {
            asignado: true,
            buscando: true,
            candidatos: candidatosEncontrados.length,
          },
        });
      }

      if (!tipoServicio || !origen || !destino) {
        return enviarJSON(res, 400, {
          error: "Faltan datos: tipoServicio, origen y destino son requeridos",
        });
      }
      if (usuarioId && usuarioId !== uid) {
        return prohibido(res, "No puedes crear un pedido a nombre de otro usuario");
      }

      // Si quien pide el delivery es un aliado (ej. un negocio pidiendo
      // que le lleven un pedido ya vendido) puede vincularlo al cliente
      // final de dos formas: por su teléfono ya verificado, o por su
      // código propio (más simple, no depende de tener el teléfono
      // verificado). Si da ambos, el código manda porque es más directo.
      let usuarioIdFinal = usuarioId || uid;
      let clienteVinculado = null;
      if (codigoCliente) {
        clienteVinculado = await usuariosStore.buscarPorCodigo(codigoCliente);
      }
      if (!clienteVinculado && telefonoCliente) {
        clienteVinculado = await usuariosStore.buscarPorTelefonoVerificado(telefonoCliente);
      }
      if (clienteVinculado) {
        usuarioIdFinal = clienteVinculado.id;
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
        usuarioId: usuarioIdFinal,
        // Quién lo creó de verdad (el aliado) — se guarda aparte del
        // usuarioId cuando el pedido terminó vinculado a otra persona.
        creadoPorId: usuarioIdFinal !== uid ? uid : null,
        nombreCliente: nombreCliente || null,
        telefonoCliente: telefonoCliente || null,
      });

      return enviarJSON(res, 200, {
        pedido,
        tarifa,
        asignacion: { asignado: true, buscando: true, candidatos: candidatos.length },
      });
    }

    // POST /pedido/procesando
    // El cliente confirma "sí, hice mi pedido" después de hablar por
    // WhatsApp con un Aliado — deja el pedido guardado en estado
    // "procesando", sin buscar conductor todavía. El Aliado lo
    // "recoge" después con el número de tracking, cuando de verdad
    // vaya a buscar quién lo lleve.
    if (req.method === "POST" && req.url === "/pedido/procesando") {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const body = await leerCuerpo(req);
      const { restauranteId, origen, destino, numeroTracking, items, subtotal, costoDelivery } =
        body;
      if (!restauranteId || !origen || !destino || !numeroTracking) {
        return enviarJSON(res, 400, {
          error: "Faltan datos: restauranteId, origen, destino y numeroTracking son requeridos",
        });
      }
      const restaurante = await restaurantesStore.obtener(restauranteId);
      const pedido = await pedidosStore.crearProcesando({
        usuarioId: uid,
        restauranteId,
        restauranteNombre: restaurante?.nombre || null,
        origen,
        destino,
        numeroTracking: numeroTracking.toUpperCase().trim(),
        items,
        subtotal,
        costoDelivery,
      });
      return enviarJSON(res, 200, { pedido });
    }

    // GET /pedido/tracking/:numeroTracking — le permite al Aliado ver
    // el costo real ANTES de comprometerse a buscar conductor, incluso
    // usando el atajo de tracking (donde no eligió direcciones él
    // mismo). Solo funciona mientras el pedido siga "procesando".
    if (
      req.method === "GET" &&
      partes[0] === "pedido" &&
      partes[1] === "tracking" &&
      partes.length === 3
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const pedido = await pedidosStore.buscarPorTracking(partes[2]);
      if (!pedido) {
        return enviarJSON(res, 404, { error: "No se encontró ese número de tracking" });
      }
      if (pedido.estado !== "procesando") {
        return enviarJSON(res, 400, { error: "Este pedido ya fue procesado antes" });
      }
      const tarifa = calcularTarifa("delivery", pedido.origen, pedido.destino);
      return enviarJSON(res, 200, {
        tarifa,
        restauranteNombre: pedido.restauranteNombre,
      });
    }

    // GET /pedido/:id — cualquiera de los involucrados puede consultarlo;
    // basta con estar autenticado (no hace falta ser específicamente uno
    // de los dos, porque un conductor candidato también necesita verlo
    // antes de aceptar).
    if (req.method === "GET" && partes[0] === "pedido" && partes.length === 2) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const pedido = await pedidosStore.obtenerPorId(partes[1]);
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });

      let conductor = null;
      if (pedido.conductorId) {
        const c = await conductoresStore.obtener(pedido.conductorId);
        conductor = infoPublicaConductor(c);
        if (conductor && c.lat != null && c.lng != null) {
          conductor.lat = c.lat;
          conductor.lng = c.lng;
          conductor.minutosEstimados = Math.round(
            (distanciaKm({ lat: c.lat, lng: c.lng }, pedido.origen) /
              fareConfig.velocidadPromedioKmh) *
              60
          );
        }
      }

      const usuario = pedido.usuarioId
        ? infoPublicaUsuario(await usuariosStore.obtener(pedido.usuarioId))
        : null;

      return enviarJSON(res, 200, { pedido, conductor, usuario });
    }

    // GET /conductores/cercanos?lat=&lng=&tipoVehiculo=
    if (req.method === "GET" && req.url.startsWith("/conductores/cercanos")) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
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

    // POST /conductor/registrar — solo puede registrar su propio perfil
    if (req.method === "POST" && req.url === "/conductor/registrar") {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const body = await leerCuerpo(req);
      const { id, nombre, telefono } = body;
      if (!id || !nombre) {
        return enviarJSON(res, 400, { error: "Faltan datos: id y nombre son requeridos" });
      }
      if (id !== uid) {
        return prohibido(res, "No puedes registrar un perfil que no es el tuyo");
      }
      const conductor = await conductoresStore.registrar({ id, nombre, telefono });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/ubicacion — solo el conductor mismo
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "ubicacion") {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const body = await leerCuerpo(req);
      const { lat, lng } = body;
      const conductor = await conductoresStore.actualizarUbicacion(partes[1], lat, lng);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/estado — solo el conductor mismo
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "estado") {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
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

    // POST /conductor/:id/documentos — solo el conductor mismo
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "documentos") {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.guardarDocumentos(partes[1], body);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/verificar — SOLO administrador. Aprobar o
    // rechazar documentos no es algo que el propio conductor deba poder
    // hacerse a sí mismo.
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "verificar") {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede hacer esto");
      const body = await leerCuerpo(req);
      const estado = body.aprobado ? "aprobado" : "rechazado";
      const conductor = await conductoresStore.actualizarVerificacion(
        partes[1],
        estado,
        body.motivo
      );
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // GET /conductor/:id/documentos — SOLO administrador. Las 4 fotos
    // que subió (licencia, cédula, papeles del vehículo, foto del
    // vehículo), para revisarlas antes de aprobar o rechazar.
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "documentos"
    ) {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede hacer esto");
      const documentos = await conductoresStore.obtenerDocumentos(partes[1]);
      return enviarJSON(res, 200, { documentos });
    }

    // GET /conductor/:id — datos completos si es él mismo consultando,
    // solo los públicos si es cualquier otro (ej. un usuario viendo a su
    // conductor ya asignado)
    if (req.method === "GET" && partes[0] === "conductor" && partes.length === 2) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const conductor = await conductoresStore.obtener(partes[1]);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      if (uid === partes[1]) {
        return enviarJSON(res, 200, { conductor });
      }
      return enviarJSON(res, 200, { conductor: infoPublicaConductor(conductor) });
    }

    // GET /conductor/:id/resumen — privado, solo el conductor mismo
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "resumen"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
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

    // GET /conductor/:id/historial — privado, solo el conductor mismo
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "historial"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const historial = await pedidosStore.obtenerPorConductor(partes[1]);
      return enviarJSON(res, 200, { historial });
    }

    // GET /conductor/:id/ganancias — privado, solo el conductor mismo
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "ganancias"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
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

    // GET /conductor/:id/viaje-activo — privado, solo el conductor mismo
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "viaje-activo"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const pedido = await pedidosStore.obtenerViajeActivoPorConductor(partes[1]);
      return enviarJSON(res, 200, { pedido });
    }

    // GET /conductor/:id/pedido-pendiente — privado, solo el conductor mismo
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "pedido-pendiente"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const pedido = await pedidosStore.obtenerPendientePorConductor(partes[1]);
      return enviarJSON(res, 200, { pedido });
    }

    // GET /conductor/:id/pedidos-pendientes — privado, solo el conductor mismo
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "pedidos-pendientes"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const pedidos = await pedidosStore.obtenerPendientesPorConductor(partes[1]);
      return enviarJSON(res, 200, { pedidos });
    }

    // POST /pedido/:id/confirmar/:conductorId
    // El conductor intenta aceptar — solo puede hacerlo en su propio
    // nombre, verificado con su token, no con lo que diga la URL.
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "confirmar"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const conductorId = partes[3];
      if (!conductorId) {
        return enviarJSON(res, 400, { error: "Falta el ID del conductor en la ruta" });
      }
      if (uid !== conductorId) return prohibido(res);
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

    // POST /pedido/:id/rechazar/:conductorId — mismo criterio
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "rechazar"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const conductorId = partes[3];
      if (!conductorId) {
        return enviarJSON(res, 400, { error: "Falta el ID del conductor en la ruta" });
      }
      if (uid !== conductorId) return prohibido(res);
      const pedido = await pedidosStore.descartarParaConductor(partes[1], conductorId);
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      return enviarJSON(res, 200, { pedido });
    }

    // POST /pedido/:id/iniciar-servicio — solo el conductor YA asignado
    // a este pedido específico (se verifica contra el pedido guardado,
    // no contra nada que mande el cliente)
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "iniciar-servicio"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const pedidoActual = await pedidosStore.obtenerPorId(partes[1]);
      if (!pedidoActual) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      if (pedidoActual.conductorId !== uid) return prohibido(res);
      const pedido = await pedidosStore.actualizarEstado(partes[1], "en_servicio");
      return enviarJSON(res, 200, { pedido });
    }

    // POST /pedido/:id/cancelar
    // Cualquiera de los dos involucrados en el pedido puede cancelarlo,
    // mientras el viaje todavía no esté en curso (en_servicio) ni ya
    // haya terminado. Si había conductor asignado, lo libera para que
    // pueda tomar otros pedidos.
    if (req.method === "POST" && partes[0] === "pedido" && partes[2] === "cancelar") {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const pedido = await pedidosStore.obtenerPorId(partes[1]);
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      if (uid !== pedido.usuarioId && uid !== pedido.conductorId) {
        return prohibido(res, "No eres parte de este viaje");
      }
      if (pedido.estado === "en_servicio" || pedido.estado === "completado") {
        return enviarJSON(res, 400, {
          error: "Ya no se puede cancelar — el viaje está en curso o ya terminó",
        });
      }
      const actualizado = await pedidosStore.actualizarEstado(partes[1], "cancelado");
      if (pedido.conductorId) {
        await conductoresStore.marcarDisponible(pedido.conductorId);
      }
      return enviarJSON(res, 200, { pedido: actualizado });
    }

    // POST /pedido/:id/completar — solo el conductor YA asignado
    if (req.method === "POST" && partes[0] === "pedido" && partes[2] === "completar") {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const pedidoActual = await pedidosStore.obtenerPorId(partes[1]);
      if (!pedidoActual) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      if (pedidoActual.conductorId !== uid) return prohibido(res);

      const body = await leerCuerpo(req);
      const pedido = await pedidosStore.actualizarEstado(partes[1], "completado");
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

    // POST /conductor/:id/pausa — solo el conductor mismo
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "pausa") {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.marcarPausado(partes[1], !!body.pausado);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/servicios — solo el conductor mismo
    if (
      req.method === "POST" &&
      partes[0] === "conductor" &&
      partes[2] === "servicios"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.actualizarServicios(partes[1], {
        carrera: body.carrera !== false,
        delivery: body.delivery !== false,
      });
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /pedido/:id/calificar-conductor  { estrellas: 1-5 }
    // Solo el usuario dueño de ESE pedido puede calificar a su conductor
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "calificar-conductor"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const body = await leerCuerpo(req);
      const pedido = await pedidosStore.obtenerPorId(partes[1]);
      if (!pedido) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      if (pedido.usuarioId !== uid) return prohibido(res);
      if (!pedido.conductorId) {
        return enviarJSON(res, 400, { error: "Este pedido no tiene conductor asignado" });
      }
      const conductor = await conductoresStore.agregarCalificacion(
        pedido.conductorId,
        Number(body.estrellas)
      );
      return enviarJSON(res, 200, { conductor });
    }

    // POST /conductor/:id/foto-perfil — solo el conductor mismo
    if (
      req.method === "POST" &&
      partes[0] === "conductor" &&
      partes[2] === "foto-perfil"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.guardarFotoPerfil(
        partes[1],
        body.fotoPerfil
      );
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // GET /conductor/:id/foto-perfil — cualquier autenticado, porque el
    // usuario asignado también necesita verla, no solo el conductor
    if (
      req.method === "GET" &&
      partes[0] === "conductor" &&
      partes[2] === "foto-perfil"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const fotoPerfil = await conductoresStore.obtenerFotoPerfil(partes[1]);
      return enviarJSON(res, 200, { fotoPerfil });
    }

    // POST /conductor/:id/zona — solo el conductor mismo
    if (req.method === "POST" && partes[0] === "conductor" && partes[2] === "zona") {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const body = await leerCuerpo(req);
      const conductor = await conductoresStore.actualizarZona(partes[1], body.zona || null);
      if (!conductor) return enviarJSON(res, 404, { error: "Conductor no registrado" });
      return enviarJSON(res, 200, { conductor });
    }

    // POST /usuario/registrar — solo puede registrar su propio perfil
    if (req.method === "POST" && req.url === "/usuario/registrar") {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const body = await leerCuerpo(req);
      const { id, nombre, telefono } = body;
      if (!id) return enviarJSON(res, 400, { error: "Falta id" });
      if (id !== uid) {
        return prohibido(res, "No puedes registrar un perfil que no es el tuyo");
      }
      const usuario = await usuariosStore.registrar({ id, nombre, telefono });
      return enviarJSON(res, 200, { usuario });
    }

    // POST /usuario/:id/tipo  { tipoUsuario: 'comun' | 'negocio' }
    // SOLO administrador — mientras no exista un flujo propio de alta
    // de aliados, esto se marca a mano (mismo patrón que aprobar
    // conductores).
    if (req.method === "POST" && partes[0] === "usuario" && partes[2] === "tipo") {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede hacer esto");
      const body = await leerCuerpo(req);
      if (body.tipoUsuario !== "comun" && body.tipoUsuario !== "negocio") {
        return enviarJSON(res, 400, { error: "tipoUsuario debe ser 'comun' o 'negocio'" });
      }
      const usuario = await usuariosStore.actualizarTipo(partes[1], body.tipoUsuario);
      if (!usuario) return enviarJSON(res, 404, { error: "Usuario no registrado" });
      return enviarJSON(res, 200, { usuario });
    }

    // POST /usuario/:id/restaurante  { restauranteId: '1' }
    // SOLO administrador — vincula una cuenta de negocio con el
    // restaurante que representa (mismo patrón manual que lo demás).
    if (req.method === "POST" && partes[0] === "usuario" && partes[2] === "restaurante") {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede hacer esto");
      const body = await leerCuerpo(req);
      if (!body.restauranteId) {
        return enviarJSON(res, 400, { error: "Falta restauranteId" });
      }
      const usuario = await usuariosStore.vincularRestaurante(partes[1], body.restauranteId);
      if (!usuario) return enviarJSON(res, 404, { error: "Usuario no registrado" });
      return enviarJSON(res, 200, { usuario });
    }

    // POST /usuario/:id/telefono/verificar — solo uno mismo puede
    // marcar SU PROPIO teléfono como verificado, y solo después de
    // haber completado la verificación por SMS con Firebase del lado
    // de la app (esto solo registra el resultado, no reenvía el SMS)
    if (
      req.method === "POST" &&
      partes[0] === "usuario" &&
      partes[2] === "telefono" &&
      partes[3] === "verificar"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const usuario = await usuariosStore.marcarTelefonoVerificado(partes[1]);
      if (!usuario) return enviarJSON(res, 404, { error: "Usuario no registrado" });
      return enviarJSON(res, 200, { usuario });
    }

    // POST /usuario/:id/foto-perfil — solo el usuario mismo
    if (
      req.method === "POST" &&
      partes[0] === "usuario" &&
      partes[2] === "foto-perfil"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      const body = await leerCuerpo(req);
      const usuario = await usuariosStore.guardarFotoPerfil(partes[1], body.fotoPerfil);
      if (!usuario) return enviarJSON(res, 404, { error: "Usuario no registrado" });
      return enviarJSON(res, 200, { usuario });
    }

    // GET /usuario/:id/foto-perfil — cualquier autenticado, porque el
    // conductor asignado también necesita verla
    if (
      req.method === "GET" &&
      partes[0] === "usuario" &&
      partes[2] === "foto-perfil"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const fotoPerfil = await usuariosStore.obtenerFotoPerfil(partes[1]);
      return enviarJSON(res, 200, { fotoPerfil });
    }

    // GET /usuario/:id — completo si es él mismo, solo lo público si es
    // cualquier otro (ej. un conductor viendo a su pasajero asignado)
    if (req.method === "GET" && partes[0] === "usuario" && partes.length === 2) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const usuario = await usuariosStore.obtener(partes[1]);
      if (!usuario) return enviarJSON(res, 404, { error: "Usuario no registrado" });
      if (uid === partes[1]) {
        return enviarJSON(res, 200, { usuario });
      }
      return enviarJSON(res, 200, { usuario: infoPublicaUsuario(usuario) });
    }

    // GET /usuario/:id/historial — privado, solo el usuario mismo.
    // Si es un Aliado (tiene restauranteId vinculado), se le suman los
    // pedidos que sus CLIENTES hicieron en su menú — si no, se
    // quedaría sin ver las ventas de su propio negocio.
    if (
      req.method === "GET" &&
      partes[0] === "usuario" &&
      partes[2] === "historial"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      if (uid !== partes[1]) return prohibido(res);
      let historial = await pedidosStore.obtenerPorUsuario(partes[1]);

      const usuario = await usuariosStore.obtener(partes[1]);
      if (usuario?.restauranteId) {
        const pedidosDelNegocio = await pedidosStore.obtenerPorRestaurante(
          usuario.restauranteId
        );
        const idsYaIncluidos = new Set(historial.map((p) => p.id));
        for (const p of pedidosDelNegocio) {
          if (!idsYaIncluidos.has(p.id)) historial.push(p);
        }
        historial.sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
      }

      return enviarJSON(res, 200, { historial });
    }

    // GET /tasa-bcv — no expone datos privados de nadie, se deja abierta
    if (req.method === "GET" && req.url === "/tasa-bcv") {
      try {
        const respuesta = await fetch("https://bcv.today/api/v1/rate.json");
        const datos = await respuesta.json();
        return enviarJSON(res, 200, {
          tasa: datos.USD,
          fecha: datos.effective_date || datos.date || null,
        });
      } catch (err) {
        return enviarJSON(res, 200, {
          tasa: 773.31,
          fecha: null,
          respaldo: true,
        });
      }
    }

    // GET /conductores — herramienta de depuración, SOLO administrador
    // (antes estaba abierta a cualquiera, exponía todos los conductores)
    if (req.method === "GET" && req.url === "/conductores") {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede ver esto");
      return enviarJSON(res, 200, await conductoresStore.todos());
    }

    // GET /restaurantes — lista de aliados activos, para que el usuario
    // los vea en la app (cualquiera autenticado puede verlos); el
    // panel de administrador también entra aquí, con su propia clave
    // en vez de una sesión de Firebase.
    if (req.method === "GET" && req.url === "/restaurantes") {
      if (!esAdmin(req)) {
        const uid = await verificarToken(req);
        if (!uid) return noAutorizado(res);
      }
      const restaurantes = await restaurantesStore.obtenerTodos();
      return enviarJSON(res, 200, { restaurantes });
    }

    // GET /restaurantes/:id — datos del restaurante + su menú completo
    if (
      req.method === "GET" &&
      partes[0] === "restaurantes" &&
      partes.length === 2
    ) {
      if (!esAdmin(req)) {
        const uid = await verificarToken(req);
        if (!uid) return noAutorizado(res);
      }
      const restaurante = await restaurantesStore.obtener(partes[1]);
      if (!restaurante) return enviarJSON(res, 404, { error: "Restaurante no encontrado" });
      const productos = await restaurantesStore.obtenerProductos(partes[1]);
      return enviarJSON(res, 200, { restaurante, productos });
    }

    // POST /restaurantes — SOLO administrador (mientras Dalgo no tenga
    // su propio panel, esto se usa manualmente para cargar aliados)
    if (req.method === "POST" && req.url === "/restaurantes") {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede hacer esto");
      const body = await leerCuerpo(req);
      if (!body.nombre) return enviarJSON(res, 400, { error: "Falta el nombre" });
      const restaurante = await restaurantesStore.crear(body);
      return enviarJSON(res, 200, { restaurante });
    }

    // PUT /restaurantes/:id — SOLO administrador
    if (
      req.method === "PUT" &&
      partes[0] === "restaurantes" &&
      partes.length === 2
    ) {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede hacer esto");
      const body = await leerCuerpo(req);
      const restaurante = await restaurantesStore.actualizar(partes[1], body);
      if (!restaurante) return enviarJSON(res, 404, { error: "Restaurante no encontrado" });
      return enviarJSON(res, 200, { restaurante });
    }

    // DELETE /restaurantes/:id — SOLO administrador. Borra el Aliado
    // completo, junto con todos sus productos.
    if (
      req.method === "DELETE" &&
      partes[0] === "restaurantes" &&
      partes.length === 2
    ) {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede hacer esto");
      await restaurantesStore.eliminar(partes[1]);
      return enviarJSON(res, 200, { eliminado: true });
    }

    // POST /restaurantes/:id/productos — SOLO administrador
    if (
      req.method === "POST" &&
      partes[0] === "restaurantes" &&
      partes[2] === "productos"
    ) {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede hacer esto");
      const body = await leerCuerpo(req);
      if (!body.nombre || body.precio == null) {
        return enviarJSON(res, 400, { error: "Faltan datos: nombre y precio son requeridos" });
      }
      const producto = await restaurantesStore.agregarProducto(partes[1], body);
      return enviarJSON(res, 200, { producto });
    }

    // PUT /restaurantes/:id/productos/:productoId — SOLO administrador
    if (
      req.method === "PUT" &&
      partes[0] === "restaurantes" &&
      partes[2] === "productos" &&
      partes.length === 4
    ) {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede hacer esto");
      const body = await leerCuerpo(req);
      const producto = await restaurantesStore.actualizarProducto(partes[1], partes[3], body);
      if (!producto) return enviarJSON(res, 404, { error: "Producto no encontrado" });
      return enviarJSON(res, 200, { producto });
    }

    // DELETE /restaurantes/:id/productos/:productoId — SOLO administrador
    if (
      req.method === "DELETE" &&
      partes[0] === "restaurantes" &&
      partes[2] === "productos" &&
      partes.length === 4
    ) {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede hacer esto");
      await restaurantesStore.eliminarProducto(partes[1], partes[3]);
      return enviarJSON(res, 200, { eliminado: true });
    }

    // GET /pedidos — herramienta de depuración, SOLO administrador
    // (antes estaba abierta a cualquiera, exponía todos los pedidos)
    if (req.method === "GET" && req.url === "/pedidos") {
      if (!esAdmin(req)) return prohibido(res, "Solo un administrador puede ver esto");
      const pedidos = await pedidosStore.todos();
      pedidos.sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
      return enviarJSON(res, 200, pedidos);
    }

    // POST /pedido/:id/mensajes  { texto: '...' }
    // Solo alguno de los dos involucrados en ESE pedido puede escribir,
    // y el servidor decide quién es "de" según el token — no lo que
    // el cliente diga en el body, para que nadie pueda fingir ser la
    // otra persona en el chat.
    if (
      req.method === "POST" &&
      partes[0] === "pedido" &&
      partes[2] === "mensajes"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const pedidoActual = await pedidosStore.obtenerPorId(partes[1]);
      if (!pedidoActual) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      if (uid !== pedidoActual.usuarioId && uid !== pedidoActual.conductorId) {
        return prohibido(res, "No eres parte de este viaje");
      }
      const body = await leerCuerpo(req);
      if (!body.texto || !body.texto.trim()) {
        return enviarJSON(res, 400, { error: "El mensaje está vacío" });
      }
      const de = uid === pedidoActual.conductorId ? "conductor" : "usuario";
      const mensaje = await pedidosStore.agregarMensaje(partes[1], {
        de,
        texto: body.texto.trim(),
      });
      return enviarJSON(res, 200, { mensaje });
    }

    // GET /pedido/:id/mensajes — solo alguno de los dos involucrados
    if (
      req.method === "GET" &&
      partes[0] === "pedido" &&
      partes[2] === "mensajes"
    ) {
      const uid = await verificarToken(req);
      if (!uid) return noAutorizado(res);
      const pedidoActual = await pedidosStore.obtenerPorId(partes[1]);
      if (!pedidoActual) return enviarJSON(res, 404, { error: "Pedido no encontrado" });
      if (uid !== pedidoActual.usuarioId && uid !== pedidoActual.conductorId) {
        return prohibido(res, "No eres parte de este viaje");
      }
      const mensajes = await pedidosStore.obtenerMensajes(partes[1]);
      return enviarJSON(res, 200, { mensajes });
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
