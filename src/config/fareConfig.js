// Configuración de tarifa REFERENCIAL — reemplazar estos valores cuando
// Dalgo confirme su fórmula real. Nada en el código depende de estos
// números específicos, así que ajustarlos aquí basta.

module.exports = {
  // Tarifas por tipo de servicio
  delivery: {
    tarifaBase: 1.0, // USD, monto fijo al iniciar el servicio
    costoPorKm: 0.35, // USD por kilómetro recorrido
    costoPorMinuto: 0.05, // USD por minuto estimado de trayecto
  },
  carrera: {
    tarifaBase: 1.5,
    costoPorKm: 0.45,
    costoPorMinuto: 0.05,
  },

  // Velocidad promedio asumida para estimar tiempo de trayecto
  // cuando no se use un servicio de rutas real (solo para el MVP)
  velocidadPromedioKmh: 25,

  // Tarifa mínima, por si el cálculo da un monto muy bajo en trayectos cortos
  tarifaMinima: 1.5,

  // La moto cuesta menos que el carro para el mismo trayecto (ajustable)
  multiplicadorPorVehiculo: {
    carro: 1,
    moto: 0.7,
  },
};
