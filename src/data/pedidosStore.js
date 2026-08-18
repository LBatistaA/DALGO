const { db } = require("../firebaseAdmin");

const COLECCION = "pedidos";

// Contador simple guardado en Firestore, para mantener IDs cortos y
// legibles (1, 2, 3...) en vez de los IDs largos que Firestore genera
// por defecto.
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

async function crear({ tipoServicio, subtipo, detalles, origen, destino, tarifa, conductorId }) {
  const id = String(await _siguienteId());
  const pedido = {
    id,
    tipoServicio,
    subtipo: subtipo || null,
    detalles: detalles || null,
    origen,
    destino,
    tarifa,
    conductorId,
    estado: "pendiente_confirmacion", // pendiente_confirmacion | confirmado | rechazado | completado
    creadoEn: new Date().toISOString(),
  };
  await db.collection(COLECCION).doc(id).set(pedido);
  return pedido;
}

async function obtenerPorId(id) {
  const snap = await db.collection(COLECCION).doc(id).get();
  return snap.exists ? snap.data() : null;
}

// Devuelve el pedido pendiente más reciente asignado a un conductor
async function obtenerPendientePorConductor(conductorId) {
  const snap = await db
    .collection(COLECCION)
    .where("conductorId", "==", conductorId)
    .get();

  const pendientes = snap.docs
    .map((d) => d.data())
    .filter((p) => p.estado === "pendiente_confirmacion")
    .sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));

  return pendientes[0] || null;
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
  actualizarEstado,
  todos,
};
