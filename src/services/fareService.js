const fareConfig = require("../config/fareConfig");
const { distanciaKm } = require("../utils/geo");

/**
 * Calcula la tarifa de un servicio.
 * @param {"delivery"|"carrera"} tipoServicio
 * @param {{lat:number, lng:number}} origen
 * @param {{lat:number, lng:number}} destino
 */
function calcularTarifa(tipoServicio, origen, destino) {
  const config = fareConfig[tipoServicio];
  if (!config) {
    throw new Error(
      `Tipo de servicio no reconocido: ${tipoServicio}. Usa "delivery" o "carrera".`
    );
  }

  const distancia = distanciaKm(origen, destino);
  const tiempoEstimadoMin =
    (distancia / fareConfig.velocidadPromedioKmh) * 60;

  const tarifaCalculada =
    config.tarifaBase +
    distancia * config.costoPorKm +
    tiempoEstimadoMin * config.costoPorMinuto;

  const tarifaFinal = Math.max(tarifaCalculada, fareConfig.tarifaMinima);

  return {
    tipoServicio,
    distanciaKm: Number(distancia.toFixed(2)),
    tiempoEstimadoMin: Number(tiempoEstimadoMin.toFixed(1)),
    tarifa: Number(tarifaFinal.toFixed(2)),
    moneda: "USD",
  };
}

module.exports = { calcularTarifa };
