import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_APP_ID'];
const missing = required.filter((key) => !import.meta.env[key]);
const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';

export const configured = missing.length === 0;
export const missingFirebaseFields = missing;
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: useEmulators ? 'demo-hr-potok' : (import.meta.env.VITE_FIREBASE_PROJECT_ID || 'hr-potok'),
  databaseURL: useEmulators ? 'https://demo-hr-potok-default-rtdb.firebaseio.com' : (import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://hr-potok-default-rtdb.europe-west1.firebasedatabase.app'),
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
};
const apps = getApps();
export const app = configured ? (apps.find((item) => item.name === '[DEFAULT]') ?? initializeApp(firebaseConfig)) : null;
export const participantApp = configured ? (apps.find((item) => item.name === 'participant') ?? initializeApp(firebaseConfig, 'participant')) : null;
export const auth = app ? getAuth(app) : null;
export const database = app ? getDatabase(app) : null;
export const functions = app ? getFunctions(app, 'europe-west1') : null;
export const participantAuth = participantApp ? getAuth(participantApp) : null;
export const participantDatabase = participantApp ? getDatabase(participantApp) : null;
export const participantFunctions = participantApp ? getFunctions(participantApp, 'europe-west1') : null;

if (app && useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:29099', { disableWarnings: true });
  connectDatabaseEmulator(database, '127.0.0.1', 29001);
  connectFunctionsEmulator(functions, '127.0.0.1', 25001);
  connectAuthEmulator(participantAuth, 'http://127.0.0.1:29099', { disableWarnings: true });
  connectDatabaseEmulator(participantDatabase, '127.0.0.1', 29001);
  connectFunctionsEmulator(participantFunctions, '127.0.0.1', 25001);
}
