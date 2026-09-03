const { distanciaKm } = require("../utils/geo");
const conductoresStore = require("../data/conductoresStore");
const fareConfig = require("../config/fareConfig");

const CANTIDAD_CANDIDATOS = 10;

/**
 * Busca hasta 10 conductores disponibles más cercanos al cliente, del
 * tipo de vehículo y tipo de servicio pedidos, para notificarles el
 * pedido a todos — el primero que acepte se lo lleva. Los conductores
 * que pasaron el límite de comisiones sin pagar quedan fuera.
 * @param {{lat:number, lng:number}} ubicacionCliente
 * @param {"moto"|"carro"|null} tipoVehiculo
 * @param {"carrera"|"delivery"|null} tipoServicio
 */
async function buscarCandidatos(ubicacionCliente, tipoVehiculo, tipoServicio) {
  const disponibles = await conductoresStore.disponibles(
    tipoVehiculo,
    tipoServicio,
    fareConfig.limiteDeudaComision
  );

  const conDistancia = disponibles.map((c) => ({
    ...c,
    distanciaKm: distanciaKm(ubicacionCliente, { lat: c.lat, lng: c.lng }),
  }));

  conDistancia.sort((a, b) => a.distanciaKm - b.distanciaKm);

  return conDistancia.slice(0, CANTIDAD_CANDIDATOS);
}

module.exports = { buscarCandidatos, CANTIDAD_CANDIDATOS };
