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
  // Carrera (taxi) — calibrada el 28/ago/2026 con precios reales de
  // Yummy en Maracay (4 viajes: moto y carro, 1.4km a 8.5km). Cada
  // vehículo tiene su propia base y costo por km — no es un
  // multiplicador simple, porque los datos reales muestran que la
  // moto y el carro no se relacionan por un porcentaje fijo (la moto
  // tiene base más alta pero cuesta menos por km recorrido).
  carrera: {
    moto: { tarifaBase: 1.35, costoPorKm: 0.24 },
    carro: { tarifaBase: 0.40, costoPorKm: 0.68 },
  },

  // Velocidad promedio asumida para estimar tiempo de trayecto
  // cuando no se use un servicio de rutas real (solo para el MVP)
  velocidadPromedioKmh: 25,

  // Tarifa mínima, por si el cálculo da un monto muy bajo en trayectos cortos
  tarifaMinima: 1.5,

  // MoviCoins que gana el usuario cada vez que completa un viaje/entrega
  moviCoinsPorViaje: 10,
};
