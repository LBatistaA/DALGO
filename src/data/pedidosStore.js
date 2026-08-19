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
async function obtenerPendientesPorConductor(conductorId) {
  const snap = await db
    .collection(COLECCION)
    .where("estado", "==", "buscando_conductor")
    .get();

  return snap.docs
    .map((d) => d.data())
    .filter(
      (p) =>
        (p.candidatos || []).includes(conductorId) &&
        !(p.descartadoPor || []).includes(conductorId)
    )
    .sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
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

module.exports = {
  crear,
  obtenerPorId,
  obtenerPendientePorConductor,
  obtenerPendientesPorConductor,
  obtenerPorConductor,
  descartarParaConductor,
  intentarConfirmar,
  actualizarEstado,
  todos,
};
