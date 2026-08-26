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
    pausado: existente ? !!existente.pausado : false, // "Descansando" — en línea pero sin recibir pedidos
    ocupado: existente ? !!existente.ocupado : false,
    lat: existente && existente.lat != null ? existente.lat : null,
    lng: existente && existente.lng != null ? existente.lng : null,
    placa: existente ? existente.placa || null : null,
    colorVehiculo: existente ? existente.colorVehiculo || null : null,
    tipoVehiculo: existente ? existente.tipoVehiculo || null : null, // 'moto' | 'carro'
    zona: existente ? existente.zona || null : null,
    // Qué tipos de servicio quiere recibir — por defecto, ambos
    serviciosActivos: existente
      ? existente.serviciosActivos || { carrera: true, delivery: true }
      : { carrera: true, delivery: true },
    tieneDocumentos: existente ? !!existente.tieneDocumentos : false,
    tieneFotoPerfil: existente ? !!existente.tieneFotoPerfil : false,
    calificacionTotal: existente ? existente.calificacionTotal || 0 : 0,
    calificacionCantidad: existente ? existente.calificacionCantidad || 0 : 0,
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
    // Ya no guardamos las fotos aquí (un documento de Firestore no
    // puede pesar más de 1 MB, y las 4 juntas fácilmente lo superan) —
    // solo marcamos que existen; cada foto va en su propio documento.
    tieneDocumentos: true,
    // Cada vez que sube/actualiza documentos, vuelve a quedar pendiente
    // de revisión (por si estaba rechazado y los corrigió).
    estadoVerificacion: "pendiente",
  };
  await ref.update(cambios);

  const docsRef = ref.collection("documentos");
  await Promise.all([
    docsRef.doc("licencia").set({ dataUrl: licencia }),
    docsRef.doc("papelesVehiculo").set({ dataUrl: papelesVehiculo }),
    docsRef.doc("cedula").set({ dataUrl: cedula }),
    docsRef.doc("fotoVehiculo").set({ dataUrl: fotoVehiculo }),
  ]);

  return { ...snap.data(), ...cambios };
}

// Trae las 4 fotos de un conductor (aparte, porque pesan mucho) — para
// cuando exista una pantalla de revisión de documentos.
async function obtenerDocumentos(id) {
  const docsRef = db.collection(COLECCION).doc(id).collection("documentos");
  const [licencia, papelesVehiculo, cedula, fotoVehiculo] = await Promise.all([
    docsRef.doc("licencia").get(),
    docsRef.doc("papelesVehiculo").get(),
    docsRef.doc("cedula").get(),
    docsRef.doc("fotoVehiculo").get(),
  ]);
  return {
    licencia: licencia.exists ? licencia.data().dataUrl : null,
    papelesVehiculo: papelesVehiculo.exists ? papelesVehiculo.data().dataUrl : null,
    cedula: cedula.exists ? cedula.data().dataUrl : null,
    fotoVehiculo: fotoVehiculo.exists ? fotoVehiculo.data().dataUrl : null,
  };
}

async function actualizarVerificacion(id, estado, motivoRechazo) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const cambios = { estadoVerificacion: estado, motivoRechazo: motivoRechazo || null };
  await ref.update(cambios);
  return { ...snap.data(), ...cambios };
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

async function marcarPausado(id, pausado) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ pausado: !!pausado });
  return { ...snap.data(), pausado: !!pausado };
}

async function actualizarServicios(id, serviciosActivos) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ serviciosActivos });
  return { ...snap.data(), serviciosActivos };
}

async function actualizarZona(id, zona) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ zona });
  return { ...snap.data(), zona };
}

// Conductores que ahora mismo podrían recibir un pedido nuevo, filtrando
// opcionalmente por tipo de vehículo ('moto' | 'carro' | null = cualquiera)
// y por tipo de servicio ('carrera' | 'delivery' | null = cualquiera).
async function disponibles(tipoVehiculo, tipoServicio) {
  const snap = await db
    .collection(COLECCION)
    .where("estadoVerificacion", "==", "aprobado")
    .get();

  const todosAprobados = snap.docs.map((d) => d.data());
  return todosAprobados.filter(
    (c) =>
      c.enLinea &&
      !c.pausado &&
      !c.ocupado &&
      c.lat != null &&
      c.lng != null &&
      (!tipoVehiculo || c.tipoVehiculo === tipoVehiculo) &&
      (!tipoServicio || c.serviciosActivos?.[tipoServicio] !== false)
  );
}

async function todos() {
  const snap = await db.collection(COLECCION).get();
  return snap.docs.map((d) => d.data());
}

// Suma una calificación (1-5) que el usuario le da al conductor al
// terminar el viaje.
async function agregarCalificacion(id, estrellas) {
  const ref = db.collection(COLECCION).doc(id);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) return null;
    const actual = snap.data();
    const actualizado = {
      calificacionTotal: (actual.calificacionTotal || 0) + estrellas,
      calificacionCantidad: (actual.calificacionCantidad || 0) + 1,
    };
    t.update(ref, actualizado);
    return { ...actual, ...actualizado };
  });
}

// La foto de perfil se guarda aparte (mismo motivo que los documentos:
// el límite de 1 MB por documento de Firestore) — solo marcamos que
// existe en el registro principal del conductor.
async function guardarFotoPerfil(id, fotoDataUrl) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.collection("documentos").doc("fotoPerfil").set({ dataUrl: fotoDataUrl });
  await ref.update({ tieneFotoPerfil: true });
  return { ...snap.data(), tieneFotoPerfil: true };
}

async function obtenerFotoPerfil(id) {
  const doc = await db
    .collection(COLECCION)
    .doc(id)
    .collection("documentos")
    .doc("fotoPerfil")
    .get();
  return doc.exists ? doc.data().dataUrl : null;
}

module.exports = {
  registrar,
  guardarDocumentos,
  obtenerDocumentos,
  guardarFotoPerfil,
  obtenerFotoPerfil,
  actualizarVerificacion,
  agregarCalificacion,
  obtener,
  actualizarUbicacion,
  marcarEnLinea,
  marcarPausado,
  actualizarServicios,
  actualizarZona,
  marcarOcupado,
  marcarDisponible,
  disponibles,
  todos,
};
