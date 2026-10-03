import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBPxd8ag3HyPM6qywsDdpM-cgCXCdjWBVo",
  authDomain: "ssg-prototype.firebaseapp.com",
  projectId: "ssg-prototype",
  storageBucket: "ssg-prototype.firebasestorage.app",
  messagingSenderId: "661854012909",
  appId: "1:661854012909:web:1fd13f3d5cc29260e7d3e4",
  measurementId: "G-BD6BHD6F0J"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
// Document binaries live in Storage, not Firestore. Firestore caps a document at
// 1MB, which is smaller than most scanned administrative documents.
export const storage = getStorage(app);
