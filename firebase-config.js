import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCFzHDLjk5xLW9-HrQT3dOm8eiotkWtnWA",
  authDomain: "cran2026.firebaseapp.com",
  projectId: "cran2026",
  storageBucket: "cran2026.firebasestorage.app",
  messagingSenderId: "911431072248",
  appId: "1:911431072248:web:b10c151c6d7c7ef102fe0d",
  measurementId: "G-ET6VQ4K4ST"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
