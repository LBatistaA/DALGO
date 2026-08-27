const { db } = require("../firebaseAdmin");

const COLECCION = "pedidos";

async function _siguienteId() {
  const ref = db.collection("_contadores").doc("pedidos");
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const actual = snap.exists ? snap.data().valor : 0;
    const siguiente = actual + 1;
    t.set(ref, { valor: siguiente });
    return siguiente;
  });
}

// Crea un pedido en estado "buscando_conductor" — se le notifica a una
// lista de conductores candidatos (los más cercanos), y el primero que
// lo acepte se lo queda.
// Número de tracking — se genera del lado del cliente cuando pide por
// WhatsApp a un Aliado, y viaja en el mensaje. Formato distinto al
// código de cliente para que no se confundan a simple vista.
function _generarNumeroTracking() {
  const caracteres = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let codigo = "";
  for (let i = 0; i < 6; i++) {
    codigo += caracteres[Math.floor(Math.random() * caracteres.length)];
  }
  return `MOVI-${codigo}`;
}

// Se crea cuando el cliente confirma "sí, hice mi pedido" después de
// hablar por WhatsApp con el Aliado — todavía no busca conductor, solo
// deja registro de que el pedido existe y a quién pertenece, para que
// el Aliado lo pueda "recoger" después con el número de tracking.
async function crearProcesando({
  usuarioId,
  restauranteId,
  restauranteNombre,
  origen,
  destino,
  numeroTracking,
  items,
  subtotal,
  costoDelivery,
}) {
  const id = String(await _siguienteId());
  const pedido = {
    id,
    tipoServicio: "delivery",
    subtipo: "aliado",
    detalles: null,
    origen,
    destino,
    tarifa: null, // se calcula cuando el aliado busca el conductor
    tipoVehiculo: null,
    candidatos: [],
    descartadoPor: [],
    conductorId: null,
    usuarioId,
    creadoPorId: null,
    nombreCliente: null,
    telefonoCliente: null,
    restauranteId,
    restauranteNombre: restauranteNombre || null,
    numeroTracking,
    // Lo que compró el cliente en el menú del Aliado — para que el
    // Aliado pueda ver el desglose desde su propia app, sin depender
    // de buscarlo en el historial de WhatsApp.
    items: items || [],
    subtotal: subtotal ?? null,
    costoDelivery: costoDelivery ?? null,
    // procesando | buscando_conductor | confirmado | en_servicio | completado
    estado: "procesando",
    creadoEn: new Date().toISOString(),
  };
  await db.collection(COLECCION).doc(id).set(pedido);
  return pedido;
}

async function buscarPorTracking(numeroTracking) {
  if (!numeroTracking) return null;
  const snap = await db
    .collection(COLECCION)
    .where("numeroTracking", "==", numeroTracking.toUpperCase().trim())
    .get();
  return snap.empty ? null : snap.docs[0].data();
}

// El Aliado ya tiene el número de tracking del cliente — esto convierte
// ese pedido "procesando" en uno real de verdad, con tarifa calculada
// y candidatos a conductor ya notificados.
async function avanzarAProcesarBusqueda(id, { tarifa, candidatos, creadoPorId }) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const cambios = {
    estado: "buscando_conductor",
    tarifa,
    candidatos,
    creadoPorId,
  };
  await ref.update(cambios);
  return { ...snap.data(), ...cambios };
}

async function crear({
  tipoServicio,
  subtipo,
  detalles,
  origen,
  destino,
  tarifa,
  tipoVehiculo,
  candidatos,
  usuarioId,
  creadoPorId,
  nombreCliente,
  telefonoCliente,
  restauranteId,
  restauranteNombre,
}) {
  const id = String(await _siguienteId());
  const pedido = {
    id,
    tipoServicio,
    subtipo: subtipo || null,
    detalles: detalles || null,
    origen,
    destino,
    tarifa,
    tipoVehiculo: tipoVehiculo || null,
    candidatos: candidatos || [], // IDs de conductores notificados
    descartadoPor: [], // IDs de conductores que lo rechazaron
    conductorId: null, // se llena cuando alguien lo acepta
    usuarioId: usuarioId || null, // quién pidió el servicio (para MoviCoins)
    // Si un aliado pidió el delivery a nombre de su cliente final, aquí
    // queda quién lo creó realmente (el aliado) — usuarioId en ese caso
    // es el cliente, para que sea él quien pueda seguirlo en su app.
    creadoPorId: creadoPorId || null,
    nombreCliente: nombreCliente || null,
    telefonoCliente: telefonoCliente || null,
    // Si el pedido es de un Aliado, para que el conductor sepa de qué
    // negocio es la entrega.
    restauranteId: restauranteId || null,
    restauranteNombre: restauranteNombre || null,
    // buscando_conductor | confirmado | completado
    estado: "buscando_conductor",
    creadoEn: new Date().toISOString(),
  };
  await db.collection(COLECCION).doc(id).set(pedido);
  return pedido;
}

async function obtenerPorId(id) {
  const snap = await db.collection(COLECCION).doc(id).get();
  return snap.exists ? snap.data() : null;
}

// El pedido "pendiente" para un conductor es el más reciente donde:
// está en su lista de candidatos, todavía nadie lo ha aceptado, y él
// mismo no lo ha descartado antes.
async function obtenerPendientePorConductor(conductorId) {
  const candidatosPara = await obtenerPendientesPorConductor(conductorId);
  return candidatosPara[0] || null;
}

// Igual que la anterior, pero devuelve TODOS los pedidos donde el
// conductor es candidato — un mismo conductor puede ser candidato de
// varios pedidos a la vez (hasta 10 candidatos por pedido), así que
// mostrarle solo "el más reciente" escondería los demás.
// Pasado este tiempo sin que nadie acepte, el pedido deja de estar
// "buscando_conductor" de verdad — pasa a "sin_conductor". No es solo
// esconderlo: es el estado real del pedido, así que también deja de
// aparecerle a cualquier otro conductor, y el cliente puede enterarse
// (ver GET /pedido/:id) para intentarlo de nuevo.
const MINUTOS_ANTES_DE_EXPIRAR = 15;

async function obtenerPendientesPorConductor(conductorId) {
  const snap = await db
    .collection(COLECCION)
    .where("estado", "==", "buscando_conductor")
    .get();

  const limiteMs = MINUTOS_ANTES_DE_EXPIRAR * 60 * 1000;
  const ahora = Date.now();
  const vigentes = [];

  for (const doc of snap.docs) {
    const p = doc.data();
    const esCandidato =
      (p.candidatos || []).includes(conductorId) &&
      !(p.descartadoPor || []).includes(conductorId);
    if (!esCandidato) continue;

    const expirado = ahora - new Date(p.creadoEn).getTime() > limiteMs;
    if (expirado) {
      // Efecto de lectura perezosa: en vez de un job aparte, el primer
      // conductor que consulta y se topa con un pedido vencido lo marca
      // como tal — así queda resuelto para siempre, no solo esta vez.
      await doc.ref.update({ estado: "sin_conductor" });
      continue;
    }

    vigentes.push(p);
  }

  return vigentes.sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
}

// Todos los pedidos que ha llevado un conductor (para su historial y
// para calcular sus ganancias) — más recientes primero.
async function obtenerPorConductor(conductorId) {
  const snap = await db
    .collection(COLECCION)
    .where("conductorId", "==", conductorId)
    .get();

  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
}

// Si el conductor aceptó un pedido y todavía no lo completó (confirmado
// o en_servicio), es su "viaje activo" — sirve para que, si cierra la
// app a la mitad de un viaje y la vuelve a abrir, retome exactamente
// donde se quedó en vez de perderlo.
async function obtenerViajeActivoPorConductor(conductorId) {
  const todos = await obtenerPorConductor(conductorId);
  return (
    todos.find((p) => p.estado === "confirmado" || p.estado === "en_servicio") ||
    null
  );
}

// Igual que la anterior, pero del lado del usuario — para su pantalla
// de "Mis viajes".
async function obtenerPorUsuario(usuarioId) {
  const snap = await db
    .collection(COLECCION)
    .where("usuarioId", "==", usuarioId)
    .get();

  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
}

// Pedidos que los CLIENTES hicieron en el menú de este Aliado — para
// que el propio Aliado (dueño del negocio) también los vea como
// suyos, aparte de los pedidos que él mismo pidió (ej. "Llevar
// pedido"), que ya cubre obtenerPorUsuario.
async function obtenerPorRestaurante(restauranteId) {
  const snap = await db
    .collection(COLECCION)
    .where("restauranteId", "==", restauranteId)
    .get();

  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
}

// Un conductor descarta el pedido — deja de vérselo a él, pero sigue
// disponible para los demás candidatos.
async function descartarParaConductor(id, conductorId) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const actual = snap.data();
  const descartadoPor = Array.from(
    new Set([...(actual.descartadoPor || []), conductorId])
  );
  await ref.update({ descartadoPor });
  return { ...actual, descartadoPor };
}

// Intento de aceptar un pedido. Usa una transacción para que, si dos
// conductores le dan "Aceptar" casi al mismo tiempo, solo uno gane —
// evita que el mismo pedido quede asignado a dos personas.
async function intentarConfirmar(id, conductorId) {
  const ref = db.collection(COLECCION).doc(id);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) {
      return { exito: false, motivo: "no_encontrado" };
    }
    const pedido = snap.data();
    if (pedido.estado !== "buscando_conductor") {
      return { exito: false, motivo: "ya_tomado", pedido };
    }
    if (!(pedido.candidatos || []).includes(conductorId)) {
      return { exito: false, motivo: "no_es_candidato" };
    }
    const actualizado = { estado: "confirmado", conductorId };
    t.update(ref, actualizado);
    return { exito: true, pedido: { ...pedido, ...actualizado } };
  });
}

async function actualizarEstado(id, nuevoEstado) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ estado: nuevoEstado });
  return { ...snap.data(), estado: nuevoEstado };
}

async function todos() {
  const snap = await db.collection(COLECCION).get();
  return snap.docs.map((d) => d.data());
}

// Chat del viaje — mensajes entre el usuario y el conductor, guardados
// como subcolección del pedido (así se borran solos si algún día se
// limpian pedidos viejos, sin dejar mensajes sueltos).
async function agregarMensaje(pedidoId, { de, texto }) {
  const mensaje = {
    de, // 'usuario' | 'conductor'
    texto,
    enviadoEn: new Date().toISOString(),
  };
  const ref = await db
    .collection(COLECCION)
    .doc(pedidoId)
    .collection("mensajes")
    .add(mensaje);
  return { id: ref.id, ...mensaje };
}

async function obtenerMensajes(pedidoId) {
  const snap = await db
    .collection(COLECCION)
    .doc(pedidoId)
    .collection("mensajes")
    .orderBy("enviadoEn", "asc")
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = {
  crear,
  crearProcesando,
  buscarPorTracking,
  avanzarAProcesarBusqueda,
  obtenerPorId,
  obtenerPendientePorConductor,
  obtenerPendientesPorConductor,
  obtenerPorConductor,
  obtenerViajeActivoPorConductor,
  obtenerPorUsuario,
  obtenerPorRestaurante,
  descartarParaConductor,
  intentarConfirmar,
  actualizarEstado,
  agregarMensaje,
  obtenerMensajes,
  todos,
};
