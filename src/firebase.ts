import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyCoVrbKitoEIxLAQ-mtdbbgtudQdai-Sks',
  authDomain: 'stellar-prints.firebaseapp.com',
  databaseURL: 'https://stellar-prints-default-rtdb.firebaseio.com',
  projectId: 'stellar-prints',
  storageBucket: 'stellar-prints.firebasestorage.app',
  messagingSenderId: '366652832927',
  appId: '1:366652832927:web:8865e93221306eca0b76aa',
  measurementId: 'G-0FJPK6F4ZV',
};

export const app = initializeApp(firebaseConfig);
export const analytics = import.meta.env.VITE_ENABLE_FIREBASE_ANALYTICS === 'true'
  ? getAnalytics(app)
  : null;
export const auth = getAuth(app);
export const db = getDatabase(app);
