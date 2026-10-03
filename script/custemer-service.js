// customer-service.js
import { db } from "./firebase-config.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function ensureCustomer(uid, phone){
  const ref = doc(db, "customers", uid);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref, { phone, name: "", address: "", subscribed: false, subscriptionStartDate: null });
  }
  return (await getDoc(ref)).data();
}

export async function setSubscription(uid, subscribed){
  const ref = doc(db, "customers", uid);
  await setDoc(ref, { subscribed, subscriptionStartDate: subscribed ? new Date() : null }, { merge: true });
}