// Almacenamiento simple en memoria para el MVP. Cuando el proyecto avance,
// esto se reemplaza por una base de datos real (PostgreSQL, por ejemplo).

let pedidos = [];
let contador = 1;

function crear({
  tipoServicio,
  subtipo,
  detalles,
  origen,
  destino,
  tarifa,
  conductorId,
}) {
  const pedido = {
    id: String(contador++),
    tipoServicio,
    subtipo: subtipo || null, // 'paquete' | 'compra' | 'diligencia' | null (taxi)
    detalles: detalles || null, // datos propios del formulario de Delivery
    origen,
    destino,
    tarifa,
    conductorId,
    estado: "pendiente_confirmacion", // pendiente_confirmacion | confirmado | rechazado
    creadoEn: new Date().toISOString(),
  };
  pedidos.push(pedido);
  return pedido;
}

function obtenerPorId(id) {
  return pedidos.find((p) => p.id === id) || null;
}

// Devuelve el pedido pendiente más reciente asignado a un conductor
function obtenerPendientePorConductor(conductorId) {
  return (
    pedidos
      .filter(
        (p) => p.conductorId === conductorId && p.estado === "pendiente_confirmacion"
      )
      .sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1))[0] || null
  );
}

function actualizarEstado(id, nuevoEstado) {
  const pedido = obtenerPorId(id);
  if (!pedido) return null;
  pedido.estado = nuevoEstado;
  return pedido;
}

module.exports = {
  crear,
  obtenerPorId,
  obtenerPendientePorConductor,
  actualizarEstado,
  todos: () => pedidos,
};
