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
  const distancia = distanciaKm(origen, destino);
  const tiempoEstimadoMin = (distancia / fareConfig.velocidadPromedioKmh) * 60;

  let tarifaCalculada;
  let vehiculoFinal = null;

  if (tipoServicio === "carrera") {
    // Cada vehículo tiene su propia base y costo por km — no hay
    // componente por minuto aquí, los datos reales de referencia no
    // mostraron evidencia de que haga falta.
    vehiculoFinal =
      tipoVehiculo && fareConfig.carrera[tipoVehiculo] ? tipoVehiculo : "carro";
    const config = fareConfig.carrera[vehiculoFinal];
    tarifaCalculada = config.tarifaBase + distancia * config.costoPorKm;
  } else if (tipoServicio === "delivery") {
    const config = fareConfig.delivery;
    tarifaCalculada =
      config.tarifaBase +
      distancia * config.costoPorKm +
      tiempoEstimadoMin * config.costoPorMinuto;
  } else {
    throw new Error(
      `Tipo de servicio no reconocido: ${tipoServicio}. Usa "delivery" o "carrera".`
    );
  }

  const tarifaFinal = Math.max(tarifaCalculada, fareConfig.tarifaMinima);

  return {
    tipoServicio,
    tipoVehiculo: vehiculoFinal,
    distanciaKm: Number(distancia.toFixed(2)),
    tiempoEstimadoMin: Number(tiempoEstimadoMin.toFixed(1)),
    tarifa: Number(tarifaFinal.toFixed(2)),
    moneda: "USD",
  };
}

module.exports = { calcularTarifa };
