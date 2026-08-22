// Firebase app singleton.
//
// Config comes from `VITE_FIREBASE_*` env vars (see .env.example). When
// they are missing we surface one clear error instead of letting the SDK
// fail deep inside an unrelated call.

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;
let storageInstance: FirebaseStorage | undefined;

function ensureApp(): FirebaseApp {
  if (!firebaseConfigured) {
    throw new Error(
      "Firebase の設定が見つかりません。.env に VITE_FIREBASE_* を設定してください",
    );
  }
  app ??= initializeApp(config);
  return app;
}

export function auth(): Auth {
  authInstance ??= getAuth(ensureApp());
  return authInstance;
}

export function db(): Firestore {
  dbInstance ??= getFirestore(ensureApp());
  return dbInstance;
}

export function storage(): FirebaseStorage {
  storageInstance ??= getStorage(ensureApp());
  return storageInstance;
}

export const googleProvider = new GoogleAuthProvider();
