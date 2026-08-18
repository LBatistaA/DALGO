const { db } = require("../firebaseAdmin");

const COLECCION = "conductores";

async function registrar({ id, nombre, telefono }) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  const existente = snap.exists ? snap.data() : null;

  const datos = {
    id,
    nombre,
    telefono: telefono || (existente ? existente.telefono || null : null),
    enLinea: existente ? !!existente.enLinea : false,
    ocupado: existente ? !!existente.ocupado : false,
    lat: existente && existente.lat != null ? existente.lat : null,
    lng: existente && existente.lng != null ? existente.lng : null,
    placa: existente ? existente.placa || null : null,
    colorVehiculo: existente ? existente.colorVehiculo || null : null,
    tipoVehiculo: existente ? existente.tipoVehiculo || null : null, // 'moto' | 'carro'
    documentos: existente ? existente.documentos || null : null,
    // pendiente | aprobado | rechazado — recién registrado no puede
    // ponerse en línea hasta que se revisen sus documentos
    estadoVerificacion: existente ? existente.estadoVerificacion || "pendiente" : "pendiente",
  };

  await ref.set(datos, { merge: true });
  return datos;
}

async function obtener(id) {
  const snap = await db.collection(COLECCION).doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function guardarDocumentos(
  id,
  { placa, colorVehiculo, tipoVehiculo, licencia, papelesVehiculo, cedula, fotoVehiculo }
) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const cambios = {
    placa,
    colorVehiculo,
    tipoVehiculo,
    documentos: { licencia, papelesVehiculo, cedula, fotoVehiculo },
    // Cada vez que sube/actualiza documentos, vuelve a quedar pendiente
    // de revisión (por si estaba rechazado y los corrigió).
    estadoVerificacion: "pendiente",
  };
  await ref.update(cambios);
  return { ...snap.data(), ...cambios };
}

async function actualizarVerificacion(id, estado) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ estadoVerificacion: estado });
  return { ...snap.data(), estadoVerificacion: estado };
}

async function actualizarUbicacion(id, lat, lng) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ lat, lng });
  return { ...snap.data(), lat, lng };
}

async function marcarEnLinea(id, enLinea) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const actual = snap.data();

  if (enLinea && actual.estadoVerificacion !== "aprobado") {
    return { ...actual, _bloqueado: true };
  }

  await ref.update({ enLinea });
  return { ...actual, enLinea };
}

async function marcarOcupado(id) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ ocupado: true });
  return { ...snap.data(), ocupado: true };
}

async function marcarDisponible(id) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ ocupado: false });
  return { ...snap.data(), ocupado: false };
}

// Conductores que ahora mismo podrían recibir un pedido nuevo, filtrando
// opcionalmente por tipo de vehículo ('moto' | 'carro' | null = cualquiera).
async function disponibles(tipoVehiculo) {
  const snap = await db
    .collection(COLECCION)
    .where("estadoVerificacion", "==", "aprobado")
    .get();

  const todosAprobados = snap.docs.map((d) => d.data());
  return todosAprobados.filter(
    (c) =>
      c.enLinea &&
      !c.ocupado &&
      c.lat != null &&
      c.lng != null &&
      (!tipoVehiculo || c.tipoVehiculo === tipoVehiculo)
  );
}

async function todos() {
  const snap = await db.collection(COLECCION).get();
  return snap.docs.map((d) => d.data());
}

module.exports = {
  registrar,
  guardarDocumentos,
  actualizarVerificacion,
  obtener,
  actualizarUbicacion,
  marcarEnLinea,
  marcarOcupado,
  marcarDisponible,
  disponibles,
  todos,
};
