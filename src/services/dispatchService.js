const { distanciaKm } = require("../utils/geo");
const conductoresStore = require("../data/conductoresStore");

const CANTIDAD_CANDIDATOS = 10;

/**
 * Busca hasta 10 conductores disponibles más cercanos al cliente, del
 * tipo de vehículo pedido, para notificarles el pedido a todos — el
 * primero que acepte se lo lleva.
 * @param {{lat:number, lng:number}} ubicacionCliente
 * @param {"moto"|"carro"|null} tipoVehiculo
 */
async function buscarCandidatos(ubicacionCliente, tipoVehiculo) {
  const disponibles = await conductoresStore.disponibles(tipoVehiculo);

  const conDistancia = disponibles.map((c) => ({
    ...c,
    distanciaKm: distanciaKm(ubicacionCliente, { lat: c.lat, lng: c.lng }),
  }));

  conDistancia.sort((a, b) => a.distanciaKm - b.distanciaKm);

  return conDistancia.slice(0, CANTIDAD_CANDIDATOS);
}

module.exports = { buscarCandidatos, CANTIDAD_CANDIDATOS };
