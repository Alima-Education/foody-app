// Konfigurasi web Firebase. Terlihat di browser oleh siapa pun, jadi bukan rahasia.
// Keamanan datanya ada di Firestore Rules, App Check, dan pembatasan API key (lihat checklist).
export const FIREBASE_PUBLIC_CONFIG = {
  apiKey: 'AIzaSyBMVvY_jXreiwkLwQ0o6sajGHQc2yfEtrA',
  authDomain: 'foody-app-def8b.firebaseapp.com',
  projectId: 'foody-app-def8b',
  storageBucket: 'foody-app-def8b.appspot.com',
  messagingSenderId: '1051493710852',
  appId: '1:1051493710852:web:1234567890abcdef',
  measurementId: 'G-1234567890',
};
// Site key reCAPTCHA v3 (publik) untuk App Check. Kosongkan kalau belum dipakai.
export const APPCHECK_SITE_KEY = '';