// Registro de conductores reales, en memoria (igual que pedidosStore —
// cuando el proyecto avance, esto se reemplaza por una base de datos real).
//
// Cada conductor tiene:
// - id: el UID de Firebase Authentication (viene de la app del conductor)
// - enLinea: true/false — el conductor activó el switch de "en línea"
// - ocupado: true/false — tiene un pedido asignado ahora mismo
// - lat/lng: su última ubicación reportada (null si nunca reportó)
//
// "Disponible para que le asignen un pedido" = enLinea && !ocupado && lat/lng conocidos

let conductores = {};

function registrar({ id, nombre, telefono }) {
  const existente = conductores[id];
  conductores[id] = {
    id,
    nombre,
    telefono: telefono || (existente ? existente.telefono : null),
    enLinea: existente ? existente.enLinea : false,
    ocupado: existente ? existente.ocupado : false,
    lat: existente ? existente.lat : null,
    lng: existente ? existente.lng : null,
    placa: existente ? existente.placa : null,
    documentos: existente ? existente.documentos : null,
    // pendiente | aprobado | rechazado — un conductor recién registrado
    // no puede ponerse en línea hasta que se revisen sus documentos
    estadoVerificacion: existente ? existente.estadoVerificacion : "pendiente",
  };
  return conductores[id];
}

function guardarDocumentos(id, { placa, licencia, papelesVehiculo, cedula, fotoVehiculo }) {
  if (!conductores[id]) return null;
  conductores[id].placa = placa;
  conductores[id].documentos = { licencia, papelesVehiculo, cedula, fotoVehiculo };
  // Cada vez que sube/actualiza documentos, vuelve a quedar pendiente
  // de revisión (por si estaba rechazado y los corrigió).
  conductores[id].estadoVerificacion = "pendiente";
  return conductores[id];
}

function actualizarVerificacion(id, estado) {
  if (!conductores[id]) return null;
  conductores[id].estadoVerificacion = estado; // 'aprobado' | 'rechazado'
  return conductores[id];
}

function obtener(id) {
  return conductores[id] || null;
}

function actualizarUbicacion(id, lat, lng) {
  if (!conductores[id]) return null;
  conductores[id].lat = lat;
  conductores[id].lng = lng;
  return conductores[id];
}

function marcarEnLinea(id, enLinea) {
  if (!conductores[id]) return null;
  // Un conductor no verificado no puede ponerse en línea, sin importar
  // qué le mande la app (protección también del lado del servidor).
  if (enLinea && conductores[id].estadoVerificacion !== "aprobado") {
    return { ...conductores[id], _bloqueado: true };
  }
  conductores[id].enLinea = enLinea;
  return conductores[id];
}

function marcarOcupado(id) {
  if (!conductores[id]) return null;
  conductores[id].ocupado = true;
  return conductores[id];
}

function marcarDisponible(id) {
  if (!conductores[id]) return null;
  conductores[id].ocupado = false;
  return conductores[id];
}

// Conductores que ahora mismo podrían recibir un pedido nuevo
function disponibles() {
  return Object.values(conductores).filter(
    (c) =>
      c.enLinea &&
      !c.ocupado &&
      c.lat != null &&
      c.lng != null &&
      c.estadoVerificacion === "aprobado"
  );
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
  todos: () => Object.values(conductores),
};
