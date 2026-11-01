import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js';
import { initializeFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { initializeAuth, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { FIREBASE_PUBLIC_CONFIG, APPCHECK_SITE_KEY } from './public-config.js';

const adminApp = initializeApp(FIREBASE_PUBLIC_CONFIG, 'admin'); // sesi terpisah dari aplikasi customer

if(APPCHECK_SITE_KEY){
  if(['localhost', '127.0.0.1'].includes(location.hostname)){
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  initializeAppCheck(adminApp, { provider: new ReCaptchaV3Provider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
}

export const db = initializeFirestore(adminApp, { experimentalAutoDetectLongPolling: true });
// sesi hanya hidup selama tab terbuka
export const auth = initializeAuth(adminApp, { persistence: browserSessionPersistence });