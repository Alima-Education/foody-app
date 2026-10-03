// auth.js
import { auth } from "./firebase-config.js";
import {
  RecaptchaVerifier, signInWithPhoneNumber
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

let confirmationResult = null;

export function initRecaptcha(){
  window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
    size: 'invisible'
  });
}

export async function sendOtp(phoneNumber){
  // phoneNumber format: +62812xxxxxxx
  confirmationResult = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
  return true;
}

export async function verifyOtp(code){
  const result = await confirmationResult.confirm(code);
  return result.user; // berisi uid
}