const admin = require("firebase-admin");

// La clave de servicio de Firebase se pasa como variable de entorno
// (todo el contenido del .json descargado, pegado como texto), nunca
// como archivo dentro del repositorio — así no queda expuesta en GitHub.
if (!admin.apps.length) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccountJson) {
    throw new Error(
      "Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT con la clave de servicio de Firebase (Configuración del proyecto > Cuentas de servicio > Generar nueva clave privada)."
    );
  }
  const serviceAccount = JSON.parse(serviceAccountJson);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

module.exports = { admin, db };
