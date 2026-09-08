import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAm4lN1zh4tl-0284k3H9bK0hufKQqyVzA",
  authDomain: "sys-rrhh-lingroup.firebaseapp.com",
  projectId: "sys-rrhh-lingroup",
  storageBucket: "sys-rrhh-lingroup.firebasestorage.app",
  messagingSenderId: "661987541058",
  appId: "1:661987541058:web:f1271079c5193a6b252ddb",
  measurementId: "G-1NXSKLV6X9"
};

const app = initializeApp(firebaseConfig);

export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  experimentalForceLongPolling: true,
  experimentalLongPollingOptions: {
    timeoutSeconds: 25
  }
});

export const auth = getAuth(app);

