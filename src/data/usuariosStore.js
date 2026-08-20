const { db } = require("../firebaseAdmin");

const COLECCION = "usuarios";

async function registrar({ id, nombre, telefono }) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  const existente = snap.exists ? snap.data() : null;

  const datos = {
    id,
    nombre: nombre || (existente ? existente.nombre || null : null),
    telefono: telefono || (existente ? existente.telefono || null : null),
    tieneFotoPerfil: existente ? !!existente.tieneFotoPerfil : false,
    moviCoins: existente ? existente.moviCoins || 0 : 0,
    viajesCompletados: existente ? existente.viajesCompletados || 0 : 0,
  };

  await ref.set(datos, { merge: true });
  return datos;
}

async function obtener(id) {
  const snap = await db.collection(COLECCION).doc(id).get();
  return snap.exists ? snap.data() : null;
}

// La foto de perfil se guarda aparte (mismo motivo que en conductores:
// el límite de 1 MB por documento de Firestore).
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

// Suma MoviCoins y cuenta un viaje más — se usa cuando un pedido se
// marca como completado. Con transacción, para que sumas simultáneas
// no se pisen entre sí.
async function agregarMoviCoins(id, cantidad) {
  const ref = db.collection(COLECCION).doc(id);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const actual = snap.exists
      ? snap.data()
      : { id, nombre: null, moviCoins: 0, viajesCompletados: 0 };

    const actualizado = {
      ...actual,
      moviCoins: (actual.moviCoins || 0) + cantidad,
      viajesCompletados: (actual.viajesCompletados || 0) + 1,
    };

    t.set(ref, actualizado, { merge: true });
    return actualizado;
  });
}

// Suma una calificación (1-5 estrellas) que el conductor le dio al
// usuario al terminar el viaje — se guarda como total+cantidad para
// poder calcular el promedio después.
async function agregarCalificacion(id, estrellas) {
  const ref = db.collection(COLECCION).doc(id);
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const actual = snap.exists
      ? snap.data()
      : {
          id,
          nombre: null,
          moviCoins: 0,
          viajesCompletados: 0,
          calificacionTotal: 0,
          calificacionCantidad: 0,
        };

    const actualizado = {
      ...actual,
      calificacionTotal: (actual.calificacionTotal || 0) + estrellas,
      calificacionCantidad: (actual.calificacionCantidad || 0) + 1,
    };

    t.set(ref, actualizado, { merge: true });
    return actualizado;
  });
}

module.exports = {
  registrar,
  obtener,
  guardarFotoPerfil,
  obtenerFotoPerfil,
  agregarMoviCoins,
  agregarCalificacion,
};
