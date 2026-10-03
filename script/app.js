// dipakai menggantikan fungsi confirmOrder() di app.js:
import { createOrder } from "./order-service.js";

async function confirmOrder(){
  const addr = document.getElementById('addrInput').value.trim();
  if(!addr){ showToast('Isi alamat pengantaran dulu'); return; }

  const items = Object.entries(cart).map(([id, qty]) => {
    const m = MENU.find(x => x.id === id);
    const price = (subscribed && m.category === 'lunch') ? Math.round(m.price * 0.9) : m.price;
    return { menuId: id, name: m.name, price, qty };
  });
  const subtotal = cartTotal();
  const ongkir = 5000;

  const { courier } = await createOrder({
    uid: auth.currentUser.uid,
    items, subtotal, ongkir, total: subtotal + ongkir,
    paymentMethod: window._payMethod,
    deliveryAddress: addr
  });

  chosenKurir = courier;
  // lanjut tampilkan konfirmasi seperti sebelumnya
}// di app.js, ganti bagian ini:
let MENU = [];
async function loadMenu(){
  MENU = await fetchMenu();
  render();
}
loadMenu(); // panggil sekali saat halaman dibuka, ganti render(); renderCart(); di baris terakhir