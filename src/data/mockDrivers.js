// Conductores de prueba con ubicación fija, solo para validar la lógica
// de asignación en el MVP. Cuando haya conductores reales usando la app,
// esto se reemplaza por sus ubicaciones en tiempo real (ej. vía websockets
// o actualizaciones periódicas de posición).

let conductores = [
  { id: "cond-1", nombre: "Carlos", lat: 10.4806, lng: -66.9036, disponible: true },
  { id: "cond-2", nombre: "María", lat: 10.4900, lng: -66.8790, disponible: true },
  { id: "cond-3", nombre: "Luis", lat: 10.4650, lng: -66.9200, disponible: true },
  { id: "cond-4", nombre: "Ana", lat: 10.5000, lng: -66.9100, disponible: false },
];

function listarDisponibles() {
  return conductores.filter((c) => c.disponible);
}

function marcarOcupado(id) {
  conductores = conductores.map((c) =>
    c.id === id ? { ...c, disponible: false } : c
  );
}

function marcarDisponible(id) {
  conductores = conductores.map((c) =>
    c.id === id ? { ...c, disponible: true } : c
  );
}

module.exports = {
  listarDisponibles,
  marcarOcupado,
  marcarDisponible,
  todos: () => conductores,
};
