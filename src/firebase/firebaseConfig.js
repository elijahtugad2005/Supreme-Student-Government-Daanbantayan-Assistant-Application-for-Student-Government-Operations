import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || "AIzaSyBPxd8ag3HyPM6qywsDdpM-cgCXCdjWBVo",
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || "ssg-prototype.firebaseapp.com",
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || "ssg-prototype",
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || "ssg-prototype.firebasestorage.app",
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "661854012909",
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || "1:661854012909:web:1fd13f3d5cc29260e7d3e4",
  measurementId: import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID || "G-BD6BHD6F0J"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// Document binaries live in Storage, not Firestore. Firestore caps a document at
// 1MB, which is smaller than most scanned administrative documents.
export const storage = getStorage(app);
