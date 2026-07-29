// Fórmula de Haversine: calcula la distancia en línea recta (km) entre
// dos coordenadas. Para el MVP esto es suficiente; más adelante se puede
// reemplazar por una API de rutas (Google Maps / OSRM) para obtener la
// distancia real de trayecto en vez de línea recta.

const RADIO_TIERRA_KM = 6371;

function aRadianes(grados) {
  return (grados * Math.PI) / 180;
}

function distanciaKm(origen, destino) {
  const dLat = aRadianes(destino.lat - origen.lat);
  const dLng = aRadianes(destino.lng - origen.lng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(aRadianes(origen.lat)) *
      Math.cos(aRadianes(destino.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return RADIO_TIERRA_KM * c;
}

module.exports = { distanciaKm };
