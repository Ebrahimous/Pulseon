import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyB5U5molflsxqV1CB1LjwkYlZj1AOTBZXI',
  authDomain: 'pulseon-d9fee.firebaseapp.com',
  projectId: 'pulseon-d9fee',
  storageBucket: 'pulseon-d9fee.firebasestorage.app',
  messagingSenderId: '11849724748',
  appId: '1:11849724748:web:46b96d080751c6943a15e9',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
