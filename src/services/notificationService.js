const { messaging } = require("../firebaseAdmin");

// Manda una notificación push a un solo dispositivo. Si el token ya
// no es válido (el usuario desinstaló la app, o hace mucho que no
// abre sesión), Firebase devuelve un error — lo atrapamos aquí para
// que NUNCA tumbe la petición que la disparó (crear un pedido,
// confirmar uno, aprobar un conductor, etc.). Una notificación que
// falla no debería romper la acción real.
async function enviarNotificacion(fcmToken, titulo, cuerpo, data = {}) {
  if (!fcmToken) return;
  try {
    await messaging.send({
      token: fcmToken,
      notification: { title: titulo, body: cuerpo },
      // FCM exige que todos los valores de "data" sean texto plano
      data: Object.fromEntries(
        Object.entries(data).map(([clave, valor]) => [clave, String(valor)])
      ),
      android: { priority: "high" },
    });
  } catch (err) {
    console.error(`No se pudo enviar notificación a ${fcmToken}:`, err.message);
  }
}

module.exports = { enviarNotificacion };
