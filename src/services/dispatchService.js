const { distanciaKm } = require("../utils/geo");
const conductoresStore = require("../data/conductoresStore");

/**
 * Encuentra al conductor real disponible más cercano a la ubicación del cliente.
 * @param {{lat:number, lng:number}} ubicacionCliente
 */
function asignarConductor(ubicacionCliente) {
  const disponibles = conductoresStore.disponibles();

  if (disponibles.length === 0) {
    return { asignado: false, motivo: "No hay conductores disponibles" };
  }

  let mejor = null;
  let mejorDistancia = Infinity;

  for (const conductor of disponibles) {
    const distancia = distanciaKm(ubicacionCliente, {
      lat: conductor.lat,
      lng: conductor.lng,
    });
    if (distancia < mejorDistancia) {
      mejorDistancia = distancia;
      mejor = conductor;
    }
  }

  return {
    asignado: true,
    conductor: {
      id: mejor.id,
      nombre: mejor.nombre,
      distanciaKm: Number(mejorDistancia.toFixed(2)),
    },
  };
}

module.exports = { asignarConductor };
