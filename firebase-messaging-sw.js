importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDE6tTSbnKT6MMlreKn97qdtjFyfHeXv84",
  authDomain: "suivi-des-anomalies-outils.firebaseapp.com",
  projectId: "suivi-des-anomalies-outils",
  storageBucket: "suivi-des-anomalies-outils.firebasestorage.app",
  messagingSenderId: "453817073269",
  appId: "1:453817073269:web:d9eb7cfa14e5425186823c"
});

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload){
  var title = (payload.notification && payload.notification.title) || "Suivi Anomalies Outils";
  var options = {
    body: (payload.notification && payload.notification.body) || "",
    data: payload.data || {}
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", function(event){
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(clients.openWindow(url));
});
