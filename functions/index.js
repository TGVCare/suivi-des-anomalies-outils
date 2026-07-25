const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

function sha256hex(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

exports.verifyPin = onCall(async (request) => {
  const pin = request.data && request.data.pin;
  if (!pin || typeof pin !== "string") throw new HttpsError("invalid-argument", "PIN manquant.");
  const snap = await db.doc("secrets/pinHash").get();
  const stored = snap.exists ? snap.data().pinHash : null;
  if (!stored) return { ok: false };
  return { ok: sha256hex(pin) === stored };
});

exports.changePin = onCall(async (request) => {
  const currentPin = request.data && request.data.currentPin;
  const newPin = request.data && request.data.newPin;
  if (!currentPin || !newPin || typeof currentPin !== "string" || typeof newPin !== "string") {
    throw new HttpsError("invalid-argument", "Code actuel et nouveau code requis.");
  }
  if (newPin.length < 4) throw new HttpsError("invalid-argument", "Le nouveau code doit contenir au moins 4 caractères.");
  const snap = await db.doc("secrets/pinHash").get();
  const stored = snap.exists ? snap.data().pinHash : null;
  if (!stored || sha256hex(currentPin) !== stored) throw new HttpsError("permission-denied", "Code actuel incorrect.");
  await db.doc("secrets/pinHash").set({ pinHash: sha256hex(newPin) });
  return { ok: true };
});

const INVALID_TOKEN_CODES = [
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered"
];

exports.notifyAdminsOnNewAnomaly = onDocumentCreated("anomalies/{anomalyId}", async (event) => {
  const anomaly = event.data.data();

  const tokensSnap = await db.collection("adminTokens").get();
  if (tokensSnap.empty) return;
  const tokens = tokensSnap.docs.map((d) => d.id);

  const title = "Nouvelle anomalie déclarée";
  const body = [anomaly.outil, anomaly.site].filter(Boolean).join(" · ") +
    (anomaly.descriptif ? " — " + anomaly.descriptif.slice(0, 100) : "");

  const resp = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: { anomalyId: event.params.anomalyId, url: "/" }
  });

  const invalidTokens = [];
  resp.responses.forEach((r, i) => {
    if (!r.success && r.error && INVALID_TOKEN_CODES.includes(r.error.code)) {
      invalidTokens.push(tokens[i]);
    }
  });
  await Promise.all(invalidTokens.map((t) => db.collection("adminTokens").doc(t).delete()));
});

exports.notifyDeclarantOnStatusChange = onDocumentUpdated("anomalies/{anomalyId}", async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();

  if (before.statut === after.statut) return;

  const notification = {
    title: "Votre ticket a été mis à jour",
    body: (after.outil || "Anomalie") + " : " + before.statut + " → " + after.statut
  };
  const data = { anomalyId: event.params.anomalyId, url: "/" };

  if (after.cp) {
    const tokensSnap = await db.collection("userTokens").doc(after.cp).collection("tokens").get();
    if (tokensSnap.empty) return;
    const tokens = tokensSnap.docs.map((d) => d.id);
    const resp = await messaging.sendEachForMulticast({ tokens, notification, data });
    const invalidTokens = [];
    resp.responses.forEach((r, i) => {
      if (!r.success && r.error && INVALID_TOKEN_CODES.includes(r.error.code)) {
        invalidTokens.push(tokens[i]);
      }
    });
    await Promise.all(invalidTokens.map((t) => db.collection("userTokens").doc(after.cp).collection("tokens").doc(t).delete()));
    return;
  }

  if (!after.notifyToken) return;
  try {
    await messaging.send({ token: after.notifyToken, notification, data });
  } catch (e) {
    if (e.code && INVALID_TOKEN_CODES.includes(e.code)) {
      await db.collection("anomalies").doc(event.params.anomalyId).update({ notifyToken: "" });
    } else {
      throw e;
    }
  }
});

const ARCHIVE_RETENTION_DAYS = 30;

exports.scheduledBackup = onSchedule({ schedule: "every 24 hours", region: "europe-west1" }, async () => {
  const anomaliesSnap = await db.collection("anomalies").get();
  const anomalies = anomaliesSnap.docs.map((d) => d.data());
  const settingsSnap = await db.doc("settings/global").get();
  const settings = settingsSnap.exists ? settingsSnap.data() : {};

  await db.collection("archives").add({
    archivedAt: new Date().toISOString(),
    auteur: "Sauvegarde automatique",
    anomalies,
    settings
  });

  const cutoff = new Date(Date.now() - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const oldSnap = await db.collection("archives").where("archivedAt", "<", cutoff).get();
  await Promise.all(oldSnap.docs.map((d) => d.ref.delete()));
});
