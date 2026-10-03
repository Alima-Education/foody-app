// firebase-config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
	SECRET_APIKEY,
	SECRET_AUTHDOMAIN,
	SECRET_PROJECTID,
	SECRET_STORAGEBUCKET,
	SECRET_MESSEGINGSENDERID,
	SECRET_APPID,
	SECRET_MEASUREMENTID,
} from '../secret';

const firebaseConfig = {
	apiKey: SECRET_APIKEY,
	authDomain: SECRET_AUTHDOMAIN,
	projectId: SECRET_PROJECTID,
	storageBucket: SECRET_STORAGEBUCKET,
	messagingSenderId: SECRET_MESSEGINGSENDERID,
	appId: SECRET_APPID,
	measurementId: SECRET_MEASUREMENTID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
