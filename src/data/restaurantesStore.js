const { db } = require("../firebaseAdmin");

const COLECCION = "restaurantes";

async function _siguienteId() {
  const ref = db.collection("contadores").doc("restaurantes");
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const actual = snap.exists ? snap.data().valor || 0 : 0;
    const siguiente = actual + 1;
    t.set(ref, { valor: siguiente }, { merge: true });
    return siguiente;
  });
}

async function crear({
  nombre,
  descripcion,
  categoria,
  tipoCategoria,
  icono,
  telefono,
  lat,
  lng,
}) {
  const id = String(await _siguienteId());
  const restaurante = {
    id,
    nombre,
    descripcion: descripcion || null,
    categoria: categoria || null, // detalle específico, ej. "Repostería"
    // Restaurantes | Supermercados | Farmacias — para filtrar en la app
    tipoCategoria: tipoCategoria || "Restaurantes",
    icono: icono || null, // nombre de ícono a mostrar (ej. "tools-kitchen-2")
    telefono: telefono || null, // para el botón "Pedir por WhatsApp"
    lat: lat != null ? Number(lat) : null, // para calcular el delivery
    lng: lng != null ? Number(lng) : null,
    activo: true,
    creadoEn: new Date().toISOString(),
  };
  await db.collection(COLECCION).doc(id).set(restaurante);
  return restaurante;
}

async function obtenerTodos({ soloActivos = true } = {}) {
  const snap = await db.collection(COLECCION).get();
  const todos = snap.docs.map((d) => d.data());
  return soloActivos ? todos.filter((r) => r.activo !== false) : todos;
}

async function obtener(id) {
  const snap = await db.collection(COLECCION).doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function actualizar(id, cambios) {
  const ref = db.collection(COLECCION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update(cambios);
  return { ...snap.data(), ...cambios };
}

// ---- Productos del menú — subcolección de cada restaurante ----

async function agregarProducto(restauranteId, { nombre, descripcion, precio, categoria, imagenUrl }) {
  const ref = db.collection(COLECCION).doc(restauranteId).collection("productos").doc();
  const producto = {
    id: ref.id,
    nombre,
    descripcion: descripcion || null,
    precio: Number(precio),
    categoria: categoria || null,
    imagenUrl: imagenUrl || null,
    disponible: true,
  };
  await ref.set(producto);
  return producto;
}

async function obtenerProductos(restauranteId) {
  const snap = await db
    .collection(COLECCION)
    .doc(restauranteId)
    .collection("productos")
    .get();
  return snap.docs.map((d) => d.data());
}

async function actualizarProducto(restauranteId, productoId, cambios) {
  const ref = db
    .collection(COLECCION)
    .doc(restauranteId)
    .collection("productos")
    .doc(productoId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  await ref.update(cambios);
  return { ...snap.data(), ...cambios };
}

async function eliminarProducto(restauranteId, productoId) {
  await db
    .collection(COLECCION)
    .doc(restauranteId)
    .collection("productos")
    .doc(productoId)
    .delete();
}

// Borra el restaurante y todos sus productos — no se puede deshacer,
// por eso el panel pide confirmación antes de llamar a esto.
async function eliminar(id) {
  const productosSnap = await db
    .collection(COLECCION)
    .doc(id)
    .collection("productos")
    .get();
  const lote = db.batch();
  productosSnap.docs.forEach((doc) => lote.delete(doc.ref));
  lote.delete(db.collection(COLECCION).doc(id));
  await lote.commit();
}

module.exports = {
  crear,
  obtenerTodos,
  obtener,
  actualizar,
  agregarProducto,
  obtenerProductos,
  actualizarProducto,
  eliminarProducto,
  eliminar,
};
