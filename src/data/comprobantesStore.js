const { db } = require("../firebaseAdmin");

const COLECCION = "comprobantes";
// La imagen va en su propio documento — un documento de Firestore no
// puede pasar de 1 MB, y así el listado del panel no arrastra las
// fotos de todos los comprobantes cada vez que se abre.
const COLECCION_IMAGENES = "comprobantesImagenes";
const COLECCION_CONFIG = "configuracion";

// El conductor sube su comprobante: queda en espera hasta que el
// administrador lo apruebe o lo rechace desde el panel.
async function crear({ conductorId, conductorNombre, monto, imagen }) {
  const ref = db.collection(COLECCION).doc();
  const comprobante = {
    id: ref.id,
    conductorId,
    conductorNombre: conductorNombre || null,
    monto: Number(monto),
    estado: "pendiente", // pendiente | aprobado | rechazado
    creadoEn: new Date().toISOString(),
    revisadoEn: null,
    motivoRechazo: null,
  };
  await ref.set(comprobante);
  if (imagen) {
    await db.collection(COLECCION_IMAGENES).doc(ref.id).set({ imagen });
  }
  return comprobante;
}

async function obtener(id) {
  const snap = await db.collection(COLECCION).doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function obtenerImagen(id) {
  const snap = await db.collection(COLECCION_IMAGENES).doc(id).get();
  return snap.exists ? snap.data().imagen : null;
}

// Todos los comprobantes, más recientes primero. El panel filtra por
// estado del lado del cliente.
async function todos() {
  const snap = await db.collection(COLECCION).get();
  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => (b.creadoEn || "").localeCompare(a.creadoEn || ""));
}

async function porConductor(conductorId) {
  const snap = await db
    .collection(COLECCION)
    .where("conductorId", "==", conductorId)
    .get();
  return snap.docs
    .map((d) => d.data())
    .sort((a, b) => (b.creadoEn || "").localeCompare(a.creadoEn || ""));
}

async function marcarRevisado(id, estado, motivoRechazo, montoAprobado) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const cambios = {
    estado,
    revisadoEn: new Date().toISOString(),
    motivoRechazo: motivoRechazo || null,
    // Lo que el administrador confirmó de verdad — puede diferir de
    // lo que el conductor declaró al subir el comprobante.
    montoAprobado: montoAprobado != null ? Number(montoAprobado) : null,
  };
  await ref.update(cambios);
  return { ...snap.data(), ...cambios };
}

// Datos de Pago Móvil de M.O.V.I. — los mismos para todos los
// conductores, se cargan una sola vez desde el panel.
async function obtenerPagoMovilEmpresa() {
  const snap = await db.collection(COLECCION_CONFIG).doc("pagoMovilEmpresa").get();
  return snap.exists ? snap.data() : null;
}

async function guardarPagoMovilEmpresa({ documento, telefono, banco, titular }) {
  const datos = { documento, telefono, banco, titular: titular || null };
  await db.collection(COLECCION_CONFIG).doc("pagoMovilEmpresa").set(datos);
  return datos;
}

module.exports = {
  crear,
  obtener,
  obtenerImagen,
  todos,
  porConductor,
  marcarRevisado,
  obtenerPagoMovilEmpresa,
  guardarPagoMovilEmpresa,
};
