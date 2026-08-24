const { db } = require("../firebaseAdmin");

const COLECCION = "usuarios";

// Código corto y fácil de decir por WhatsApp — evita caracteres que se
// confunden entre sí (0/O, 1/I/l).
function _generarCodigo() {
  const caracteres = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let codigo = "";
  for (let i = 0; i < 6; i++) {
    codigo += caracteres[Math.floor(Math.random() * caracteres.length)];
  }
  return codigo;
}

async function registrar({ id, nombre, telefono }) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  const existente = snap.exists ? snap.data() : null;

  // Si cambia el número de teléfono respecto al que ya tenía guardado,
  // la verificación anterior deja de servir — hay que verificar el
  // nuevo número desde cero.
  const telefonoCambio =
    telefono && existente && existente.telefono && telefono !== existente.telefono;

  const datos = {
    id,
    nombre: nombre || (existente ? existente.nombre || null : null),
    telefono: telefono || (existente ? existente.telefono || null : null),
    tieneFotoPerfil: existente ? !!existente.tieneFotoPerfil : false,
    moviCoins: existente ? existente.moviCoins || 0 : 0,
    viajesCompletados: existente ? existente.viajesCompletados || 0 : 0,
    tipoUsuario: existente ? existente.tipoUsuario || "comun" : "comun",
    telefonoVerificado: telefonoCambio
      ? false
      : existente
      ? !!existente.telefonoVerificado
      : false,
    // Código propio para vincular pedidos sin depender del teléfono —
    // se genera una sola vez, la primera vez que se registra.
    codigoCliente: existente ? existente.codigoCliente || _generarCodigo() : _generarCodigo(),
    // Si es una cuenta de negocio, a qué restaurante representa (para
    // que "Llevar pedido" sepa de dónde recoger sin tener que
    // escribirlo cada vez).
    restauranteId: existente ? existente.restauranteId || null : null,
  };

  await ref.set(datos, { merge: true });
  return datos;
}

async function buscarPorCodigo(codigo) {
  if (!codigo) return null;
  const snap = await db
    .collection(COLECCION)
    .where("codigoCliente", "==", codigo.toUpperCase().trim())
    .get();
  return snap.empty ? null : snap.docs[0].data();
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

async function actualizarTipo(id, tipoUsuario) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ tipoUsuario });
  return { ...snap.data(), tipoUsuario };
}

async function vincularRestaurante(id, restauranteId) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ restauranteId });
  return { ...snap.data(), restauranteId };
}

// El cliente ya completó la verificación por SMS con Firebase del lado
// de la app — aquí solo queda el registro de que ese número específico
// quedó confirmado.
async function marcarTelefonoVerificado(id) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update({ telefonoVerificado: true });
  return { ...snap.data(), telefonoVerificado: true };
}

// Busca un usuario por su teléfono — SOLO cuenta si ese número ya está
// verificado, para que nadie pueda vincular un pedido al número de
// otra persona sin que esa persona lo haya confirmado antes.
// Un solo .where() (por teléfono) y el resto se filtra en código, para
// no arriesgar necesitar un índice compuesto en Firestore.
async function buscarPorTelefonoVerificado(telefono) {
  if (!telefono) return null;
  const snap = await db.collection(COLECCION).where("telefono", "==", telefono).get();
  const encontrado = snap.docs
    .map((d) => d.data())
    .find((u) => u.telefonoVerificado === true);
  return encontrado || null;
}

module.exports = {
  registrar,
  obtener,
  guardarFotoPerfil,
  obtenerFotoPerfil,
  agregarMoviCoins,
  agregarCalificacion,
  actualizarTipo,
  marcarTelefonoVerificado,
  buscarPorTelefonoVerificado,
  buscarPorCodigo,
  vincularRestaurante,
};
