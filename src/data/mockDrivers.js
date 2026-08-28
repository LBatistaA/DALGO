// Conductores de prueba con ubicación fija, solo para validar la lógica
// de asignación en el MVP. Cuando haya conductores reales usando la app,
// esto se reemplaza por sus ubicaciones en tiempo real (ej. vía websockets
// o actualizaciones periódicas de posición).

let conductores = [
  { id: "cond-1", nombre: "Carlos", lat: 10.2466, lng: -67.5947, disponible: true },
  { id: "cond-2", nombre: "María", lat: 10.2560, lng: -67.5700, disponible: true },
  { id: "cond-3", nombre: "Luis", lat: 10.2310, lng: -67.6110, disponible: true },
  { id: "cond-4", nombre: "Ana", lat: 10.2660, lng: -67.6010, disponible: false },
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
