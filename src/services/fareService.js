const fareConfig = require("../config/fareConfig");
const { distanciaKm } = require("../utils/geo");

/**
 * Calcula la tarifa de un servicio.
 * @param {"delivery"|"carrera"} tipoServicio
 * @param {{lat:number, lng:number}} origen
 * @param {{lat:number, lng:number}} destino
 * @param {"carro"|"moto"|null} tipoVehiculo — solo aplica a "carrera"
 */
function calcularTarifa(tipoServicio, origen, destino, tipoVehiculo) {
  const config = fareConfig[tipoServicio];
  if (!config) {
    throw new Error(
      `Tipo de servicio no reconocido: ${tipoServicio}. Usa "delivery" o "carrera".`
    );
  }

  const distancia = distanciaKm(origen, destino);
  const tiempoEstimadoMin =
    (distancia / fareConfig.velocidadPromedioKmh) * 60;

  let tarifaCalculada =
    config.tarifaBase +
    distancia * config.costoPorKm +
    tiempoEstimadoMin * config.costoPorMinuto;

  const multiplicador =
    tipoVehiculo && fareConfig.multiplicadorPorVehiculo[tipoVehiculo] != null
      ? fareConfig.multiplicadorPorVehiculo[tipoVehiculo]
      : 1;
  tarifaCalculada *= multiplicador;

  const tarifaFinal = Math.max(tarifaCalculada, fareConfig.tarifaMinima);

  return {
    tipoServicio,
    tipoVehiculo: tipoVehiculo || null,
    distanciaKm: Number(distancia.toFixed(2)),
    tiempoEstimadoMin: Number(tiempoEstimadoMin.toFixed(1)),
    tarifa: Number(tarifaFinal.toFixed(2)),
    moneda: "USD",
  };
}

module.exports = { calcularTarifa };
