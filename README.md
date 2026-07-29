# Dalgo MVP - Backend de tarifa y asignación

Backend mínimo que resuelve el cuello de botella actual: calcular la tarifa
y asignar conductor automáticamente (hoy toma ~30 min manual, aquí es
instantáneo).

Sin dependencias externas — usa solo el módulo `http` nativo de Node, así
que corre sin `npm install`.

## Cómo correrlo

```bash
node src/server.js
```

Servidor arranca en `http://localhost:3000`.

## Endpoints

### POST /pedido
Calcula tarifa y asigna conductor en una sola llamada.

```bash
curl -X POST http://localhost:3000/pedido \
  -H "Content-Type: application/json" \
  -d '{
    "tipoServicio": "delivery",
    "origen": {"lat": 10.4806, "lng": -66.9036},
    "destino": {"lat": 10.5000, "lng": -66.8500}
  }'
```

`tipoServicio` puede ser `"delivery"` o `"carrera"`.

### GET /conductores
Ver el estado de los conductores de prueba (quién está disponible/ocupado).

```bash
curl http://localhost:3000/conductores
```

## Qué ajustar cuando hables con Dalgo

- `src/config/fareConfig.js` — reemplaza `tarifaBase`, `costoPorKm`,
  `costoPorMinuto` por sus valores reales, y agrega recargos (hora pico,
  zona, nocturno) si aplica.
- `src/data/mockDrivers.js` — esto es temporal, solo para probar la
  lógica. Cuando haya conductores reales con la app, sus ubicaciones se
  actualizan en tiempo real en vez de estar fijas aquí.
- `src/utils/geo.js` — usa distancia en línea recta (Haversine). Cuando
  quieran precisión real de calle, se reemplaza por una API de rutas
  (Google Maps o alternativa basada en OpenStreetMap).

## Siguiente paso

Conectar esto a la app en Flutter: el botón de "pedir" en la app llama a
`POST /pedido` y muestra la tarifa + conductor asignado en pantalla.
