// order-service.js
import { db } from "./firebase-config.js";
import { collection, addDoc, serverTimestamp, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

async function pickAvailableCourier(){
  const q = query(collection(db, "couriers"), where("active", "==", true));
  const snap = await getDocs(q);
  const couriers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if(!couriers.length) return { name: "Belum ada kurir tersedia", vehicle: "-", plate: "-" };
  return couriers[Math.floor(Math.random() * couriers.length)];
}

export async function createOrder({ uid, items, subtotal, ongkir, total, paymentMethod, deliveryAddress }){
  const courier = await pickAvailableCourier();
  const ref = await addDoc(collection(db, "orders"), {
    customerId: uid,
    items, subtotal, ongkir, total,
    status: "baru",
    paymentMethod,
    deliveryAddress,
    courier,
    createdAt: serverTimestamp()
  });
  return { orderId: ref.id, courier };
}