// A partir de la versión 14 de firebase-admin, la forma "clásica" de
// conectarse (admin.initializeApp(), admin.firestore()) ya no existe —
// hay que usar la sintaxis modular nueva, importando cada pieza aparte.
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountJson) {
  throw new Error(
    "Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT con la clave de servicio de Firebase (Configuración del proyecto > Cuentas de servicio > Generar nueva clave privada)."
  );
}
const serviceAccount = JSON.parse(serviceAccountJson);

// getApps() evita inicializar dos veces si este archivo se carga más
// de una vez (puede pasar según cómo Node cachee los módulos).
const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore(app);
const auth = getAuth(app);

module.exports = { db, auth };
