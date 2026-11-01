import { auth, db } from './firebase-config.js';
import { sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink, onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, doc, getDoc, getDocFromServer, onSnapshot, query, where, serverTimestamp, writeBatch }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { MENU, CATS, money } from '../constant/food.js';
import { unitPrice, calcOrder, ONGKIR } from '../constant/pricing.js';

/* ====== UTIL ====== */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const drawerOpen = () => !$('drawer').classList.contains('translate-x-full');

/* ====== STATE (di dalam modul, tidak diekspos ke window) ====== */
let currentUser = null;
let cart = {};                       // { idMenu: jumlah }
let activeCat = 'all';
let subscribed = false;              // hanya dari Firestore (/subscribers/uid), diatur admin
let payMethod = '';
let customer = { name: '' };
let loginEmail = '';                 // email tujuan tautan masuk
let awaitingLink = false;            // layar "cek email" sedang tampil
let linkTimer = null;
let isSubmitting = false;
let orderAttempt = null;             // { sig, ref, code }
let historyUnsub = null;

let authReadyResolve;
const authReady = new Promise(resolve => { authReadyResolve = resolve; });

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if(!user) stopHistoryListener();
  updateAccountBar();
  authReadyResolve();
  await refreshSubscription();

  // tautan diklik di tab lain → tab ini yang sedang menunggu langsung lanjut
  if(user && awaitingLink && drawerOpen()){
    awaitingLink = false;
    clearInterval(linkTimer);
    showToast('Berhasil masuk!', 'success');
    renderCustomerStep();
  }
});

async function refreshSubscription(){
  subscribed = false;
  if(currentUser){
    try{
      const snap = await getDoc(doc(db, 'subscribers', currentUser.uid));
      subscribed = snap.exists();
    }catch(err){
      console.warn('Status langganan tidak terbaca:', err.code);
    }
  }
  updateSubBanner();
  render();
}

/* ====== PENYIMPANAN DATA PRIBADI ======
   Profil (nama) hanya di sessionStorage. Email tujuan tautan disimpan sementara di
   localStorage (supaya tab baru bisa menyelesaikan login) dan dihapus setelah masuk/keluar. */
const PROFILE_KEY = 'foody_profile';
const PENDING_EMAIL_KEY = 'foody_login_email';
function getProfile(){
  try{
    const p = JSON.parse(sessionStorage.getItem(PROFILE_KEY)) || {};
    return (currentUser && p.uid === currentUser.uid) ? p : {};
  }catch(e){ return {}; }
}
function saveProfile(p){
  try{ sessionStorage.setItem(PROFILE_KEY, JSON.stringify({ ...p, uid: currentUser ? currentUser.uid : '' })); }
  catch(e){ console.error('Gagal simpan profil:', e); }
}
function clearStoredData(){
  try{
    [sessionStorage, localStorage].forEach(st =>
      Object.keys(st).filter(k => k.startsWith('foody_')).forEach(k => st.removeItem(k)));
  }catch(e){ console.error('Gagal hapus data lokal:', e); }
}
function purgeLegacyLocalData(){ // sisa versi lama (profil/riwayat per-uid di localStorage)
  try{
    Object.keys(localStorage)
      .filter(k => k.startsWith('foody_profile_') || k.startsWith('foody_orders_'))
      .forEach(k => localStorage.removeItem(k));
  }catch(e){}
}

/* ====== LOGOUT OTOMATIS SAAT TIDAK AKTIF (perangkat bersama) ====== */
const IDLE_MS = 30 * 60 * 1000;
let lastActivity = Date.now();
['click', 'keydown', 'touchstart', 'input'].forEach(ev =>
  document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
setInterval(() => {
  if(currentUser && Date.now() - lastActivity > IDLE_MS) performLogout('Sesi berakhir karena tidak aktif.');
}, 30000);

/* ====== TOAST ====== */
const TOAST_STYLE = {
  success: { cls: 'bg-herb text-[#0d2420] border-herb', icon: '✓' },
  error:   { cls: 'bg-chili text-white border-chili',   icon: '!' },
  info:    { cls: 'bg-surface text-ink border-white/30', icon: 'i' },
};
function guessToastType(msg){
  if(/(berhasil|terverifikasi|ditambahkan|dikirim)/i.test(msg)) return 'success';
  if(/(gagal|salah|kedaluwarsa|tidak |terlalu|tunggu|habis|ditolak|kesalahan|belum benar|harus|^isi |^pilih |^lengkapi |berakhir)/i.test(msg)) return 'error';
  return 'info';
}
function showToast(msg, type){
  const s = TOAST_STYLE[type || guessToastType(msg)];
  const t = $('toast');
  $('toastInner').className = `flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl text-sm font-semibold ${s.cls}`;
  $('toastIcon').textContent = s.icon;
  $('toastText').textContent = msg;
  t.classList.remove('opacity-0', '-translate-y-24');
  t.classList.add('opacity-100', 'translate-y-0');
  clearTimeout(window._tt);
  window._tt = setTimeout(() => {
    t.classList.add('opacity-0', '-translate-y-24');
    t.classList.remove('opacity-100', 'translate-y-0');
  }, s.icon === '!' ? 4500 : 3000);
}

/* ====== SUARA ====== */
let audioCtx = null;
function unlockAudio(){
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    if(!audioCtx) audioCtx = new AC();
    if(audioCtx.state === 'suspended') audioCtx.resume();
  }catch(e){}
}
function playSuccessSound(){
  try{
    unlockAudio();
    if(!audioCtx) return;
    const now = audioCtx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
    if(navigator.vibrate) navigator.vibrate([80, 40, 120]);
  }catch(e){ console.warn('Suara gagal diputar:', e); }
}

/* ====== MENU & KERANJANG ====== */
function renderTabs(){
  $('tabs').innerHTML = CATS.map(([k, l]) =>
    `<button data-action="setCat" data-cat="${esc(k)}"
      class="flex-none rounded-full border text-sm font-semibold px-4 py-1.5 ${k === activeCat ? 'bg-chili text-white border-chili' : 'bg-card text-inksoft border-line'}">${esc(l)}</button>`).join('');
}
function setCat(c){ activeCat = c; renderTabs(); render(); }

function updateSubBanner(){
  $('subDesc').textContent = subscribed
    ? 'Langganan aktif: diskon 10% untuk semua menu lunch.'
    : 'Diskon 10% untuk menu lunch. Hubungi admin untuk mengaktifkan langganan.';
  $('subBadge').textContent = subscribed ? 'Aktif' : 'Belum aktif';
  $('subBadge').className = 'flex-none rounded-full px-3 py-1 text-xs font-bold ' +
    (subscribed ? 'bg-[#0d2420] text-herb' : 'bg-black/15 text-[#0d2420]');
}

function render(){
  const q = $('search').value.toLowerCase();
  const filtered = MENU.filter(m => (activeCat === 'all' || m.cat === activeCat) && m.name.toLowerCase().includes(q));
  const groups = { lunch: 'Menu Lunch', dessert: 'Dessert', drink: 'Minuman' };
  let html = '';
  Object.keys(groups).forEach(cat => {
    const items = filtered.filter(m => m.cat === cat);
    if(!items.length) return;
    html += `<div class="flex items-center gap-3 text-base font-serif mt-6 mb-3">${groups[cat]}<span class="flex-1 h-px bg-line"></span></div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">`;
    items.forEach(m => {
      const price = unitPrice(m, subscribed);
      const qty = cart[m.id] || 0;
      const priceHtml = (subscribed && cat === 'lunch')
        ? `<s class="text-inksoft font-normal text-xs mr-1">${money(m.price)}</s>${money(price)}`
        : money(price);
      html += `<div class="bg-card border border-line rounded-2xl p-4 flex flex-col gap-1">
        <h4 class="font-semibold text-sm">${esc(m.name)}</h4>
        <p class="text-xs text-inksoft">${esc(m.desc)}</p>
        <div class="flex items-center justify-between mt-2">
          <div class="font-bold text-chilidark text-sm">${priceHtml}</div>
          ${qty === 0
            ? `<button data-action="addItem" data-id="${m.id}" class="w-9 h-9 rounded-full bg-chili text-white text-lg leading-none" aria-label="Tambah">+</button>`
            : `<div class="flex items-center gap-2.5">
                 <button data-action="changeQty" data-id="${m.id}" data-d="-1" class="w-7 h-7 rounded-full border border-line bg-surface text-ink">–</button>
                 <span class="text-sm w-4 text-center">${qty}</span>
                 <button data-action="changeQty" data-id="${m.id}" data-d="1" class="w-7 h-7 rounded-full border border-line bg-surface text-ink">+</button>
               </div>`}
        </div></div>`;
    });
    html += `</div>`;
  });
  $('menuArea').innerHTML = html || `<p class="text-center text-inksoft py-10 text-sm">Menu tidak ditemukan.</p>`;
}

function updateBadge(){ $('cartCount').textContent = Object.values(cart).reduce((a, b) => a + b, 0); }
function addItem(id){
  if(!MENU.some(m => m.id === id)) return;
  cart[id] = 1; render(); renderCart(); updateBadge(); showToast('Ditambahkan ke keranjang');
}
function changeQty(id, d){
  if(!MENU.some(m => m.id === id)) return;
  cart[id] = Math.min(50, (cart[id] || 0) + d);
  if(cart[id] <= 0) delete cart[id];
  render(); renderCart(); updateBadge();
}

function renderCart(){
  $('drawerTitle').textContent = 'Keranjang';
  const c = calcOrder(cart, subscribed);
  $('cartBody').innerHTML = c.lines.length ? c.lines.map(l => `
    <div class="flex justify-between gap-3 py-2.5 border-b border-line">
      <div><div class="font-semibold text-sm">${esc(l.name)}</div><div class="text-xs text-inksoft">${l.qty} x ${money(l.price)}</div></div>
      <div class="font-semibold text-sm">${money(l.price * l.qty)}</div>
    </div>`).join('')
    : `<div class="text-center text-inksoft text-sm py-16">Keranjang masih kosong.<br>Pilih menu untuk mulai memesan.</div>`;

  $('cartFoot').innerHTML = c.lines.length ? `
    <div class="flex justify-between text-sm mb-1.5"><span>Subtotal</span><span>${money(c.subtotal)}</span></div>
    <div class="flex justify-between text-sm mb-1.5"><span>Ongkir</span><span>${money(ONGKIR)}</span></div>
    <div class="flex justify-between font-bold text-base mt-2 mb-3"><span>Total</span><span>${money(c.total)}</span></div>
    <select id="payMethod" class="w-full border border-line bg-card text-ink rounded-lg px-3 py-2.5 mb-3 text-sm">
      <option value="">Pilih metode pembayaran</option>
      <option value="qris">QRIS</option>
      <option value="transfer">Transfer Bank</option>
      <option value="cod">Bayar di Tempat (COD)</option>
    </select>
    <button data-action="checkout" class="w-full bg-chili text-white font-bold rounded-full py-3 text-sm">Bayar Sekarang</button>` : '';
}

function checkout(){
  const sel = $('payMethod');
  const method = sel ? sel.value : '';
  if(!['qris', 'transfer', 'cod'].includes(method)){ showToast('Pilih metode pembayaran dulu'); return; }
  payMethod = method;
  if(currentUser) renderCustomerStep(); else renderLoginStep();
}

/* ====== LOGIN EMAIL (tautan masuk bawaan Firebase) ====== */
const actionCodeSettings = () => ({ url: location.origin + location.pathname, handleCodeInApp: true });

function linkErrorMessage(err){
  if(err.code === 'auth/unauthorized-continue-uri') return 'Domain halaman ini belum diizinkan di Firebase (Authorized domains).';
  if(err.code === 'auth/operation-not-allowed') return 'Login tautan email belum diaktifkan di Firebase.';
  if(err.code === 'auth/invalid-email') return 'Format email belum benar.';
  if(err.code === 'auth/too-many-requests') return 'Terlalu banyak permintaan, coba lagi beberapa menit lagi.';
  return 'Gagal kirim tautan, coba lagi.';
}

function renderLoginStep(){
  awaitingLink = false;
  clearInterval(linkTimer);
  $('drawerTitle').textContent = 'Masuk untuk lanjut';
  $('cartBody').innerHTML = `
    <p class="text-sm text-inksoft mb-4">Masukkan emailmu. Kami kirim tautan masuk ke emailmu, tanpa password. Klik tautan itu untuk masuk.</p>
    <label class="text-sm font-semibold" for="loginEmail">Email</label>
    <input id="loginEmail" type="email" autocomplete="email" placeholder="nama@email.com" maxlength="120" value="${esc(loginEmail)}"
      class="w-full border border-line bg-card text-ink placeholder:text-inksoft/70 rounded-lg px-3 py-2.5 mt-1.5 text-sm">
    <p class="text-xs text-inksoft mt-1.5">Email ini menjadi identitas akunmu dan dipakai sebagai kontak pesanan.</p>`;
  $('cartFoot').innerHTML = `<button data-action="sendLoginLink" class="w-full bg-chili text-white font-bold rounded-full py-3 text-sm">Kirim Tautan Masuk</button>`;
}

async function sendLoginLink(){
  const email = $('loginEmail').value.trim().toLowerCase();
  if(email.length > 120 || !EMAIL_RE.test(email)){ showToast('Format email belum benar'); return; }
  loginEmail = email;
  $('cartFoot').innerHTML = `<button disabled class="w-full bg-chili/50 text-white font-bold rounded-full py-3 text-sm">Mengirim tautan...</button>`;
  try{
    await sendSignInLinkToEmail(auth, email, actionCodeSettings());
    try{ localStorage.setItem(PENDING_EMAIL_KEY, email); }catch(e){}
    renderCheckEmailStep(email, 60);
  }catch(err){
    console.error('Gagal kirim tautan:', err.code, err.message);
    showToast(linkErrorMessage(err), 'error');
    renderLoginStep();
  }
}

function renderCheckEmailStep(email, seconds){
  awaitingLink = true;
  $('drawerTitle').textContent = 'Cek emailmu';
  $('cartBody').innerHTML = `
    <div class="text-center py-6">
      <div class="mx-auto w-16 h-16 rounded-full bg-surface border border-line flex items-center justify-center text-2xl">✉</div>
      <h4 class="font-serif text-xl mt-4">Tautan masuk terkirim</h4>
      <p class="text-sm text-inksoft mt-2">Kami kirim tautan ke <span class="text-ink font-semibold">${esc(email)}</span>. Buka emailmu (cek juga folder spam), lalu klik tautannya. Halaman ini lanjut otomatis setelah kamu masuk.</p>
    </div>
    <button data-action="renderLoginStep" class="text-xs font-semibold text-herb underline">Ganti email</button>`;
  $('cartFoot').innerHTML = `<button id="linkResendBtn" data-action="resendLoginLink" class="w-full border border-line rounded-full py-3 text-sm font-semibold">Kirim ulang</button>`;
  startLinkCountdown(seconds);
}

function startLinkCountdown(seconds){
  clearInterval(linkTimer);
  const btn = $('linkResendBtn');
  if(!btn) return;
  let left = seconds;
  btn.disabled = true;
  btn.classList.add('opacity-50');
  btn.textContent = `Kirim ulang (${left})`;
  linkTimer = setInterval(() => {
    const b = $('linkResendBtn');
    if(!b){ clearInterval(linkTimer); return; } // layar sudah berganti
    left -= 1;
    if(left <= 0){
      clearInterval(linkTimer);
      b.disabled = false;
      b.classList.remove('opacity-50');
      b.textContent = 'Kirim ulang';
    }else{
      b.textContent = `Kirim ulang (${left})`;
    }
  }, 1000);
}

async function resendLoginLink(){
  const btn = $('linkResendBtn');
  if(btn) btn.disabled = true;
  try{
    await sendSignInLinkToEmail(auth, loginEmail, actionCodeSettings());
    showToast('Tautan baru dikirim', 'success');
    startLinkCountdown(60);
  }catch(err){
    console.error('Gagal kirim ulang tautan:', err.code, err.message);
    showToast(linkErrorMessage(err), 'error');
    if(btn) btn.disabled = false;
  }
}

// dipanggil saat halaman dibuka lewat tautan dari email
async function completeEmailLinkSignIn(){
  if(!isSignInWithEmailLink(auth, location.href)) return;
  let email = '';
  try{ email = localStorage.getItem(PENDING_EMAIL_KEY) || ''; }catch(e){}
  if(!email){ // dibuka di browser/perangkat lain
    email = (window.prompt('Masukkan email yang kamu pakai untuk meminta tautan masuk:') || '').trim().toLowerCase();
  }
  const cleanUrl = () => history.replaceState(null, '', location.pathname);
  if(!email){ cleanUrl(); return; }
  try{
    await signInWithEmailLink(auth, email, location.href);
    try{ localStorage.removeItem(PENDING_EMAIL_KEY); }catch(e){}
    cleanUrl();
    showLinkSignedIn();
  }catch(err){
    console.error('Tautan masuk gagal:', err.code, err.message);
    cleanUrl();
    showToast('Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.', 'error');
  }
}

function showLinkSignedIn(){
  $('drawerTitle').textContent = 'Berhasil masuk';
  $('cartBody').innerHTML = `
    <div class="text-center py-10">
      <div class="mx-auto w-16 h-16 rounded-full bg-herb text-[#0d2420] flex items-center justify-center text-3xl font-bold">✓</div>
      <h4 class="font-serif text-xl mt-4">Kamu sudah masuk</h4>
      <p class="text-sm text-inksoft mt-2">Kalau tadi kamu sedang memesan di tab lain, tab itu akan lanjut otomatis dan tab ini boleh ditutup.</p>
    </div>`;
  $('cartFoot').innerHTML = `<button data-action="closeCart" class="w-full bg-herb text-[#0d2420] font-bold rounded-full py-3 text-sm">Mulai memesan di sini</button>`;
  $('drawer').classList.remove('translate-x-full');
  $('overlay').classList.remove('opacity-0', 'pointer-events-none');
}

/* ====== DATA PEMESAN ====== */
function renderCustomerStep(){
  if(!currentUser){ renderLoginStep(); return; }
  const saved = getProfile();
  $('drawerTitle').textContent = 'Data Pemesan';
  $('cartBody').innerHTML = `
    <p class="text-sm text-inksoft mb-4">Isi namamu sebelum lanjut ke pengantaran.</p>
    <div class="mb-4">
      <label class="text-sm font-semibold" for="nameInput">Nama lengkap</label>
      <input id="nameInput" type="text" autocomplete="name" placeholder="Nama kamu" maxlength="60" value="${esc(saved.name || '')}"
        class="w-full border border-line bg-card text-ink placeholder:text-inksoft/70 rounded-lg px-3 py-2.5 mt-1.5 text-sm">
    </div>
    <div>
      <div class="text-sm font-semibold">Email</div>
      <div class="mt-1.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-inksoft break-words">${esc(currentUser.email)}</div>
      <p class="text-xs text-inksoft mt-1.5">Email akunmu, sudah terverifikasi lewat tautan masuk.</p>
    </div>`;
  $('cartFoot').innerHTML = `
    <div class="flex gap-3">
      <button data-action="renderCart" class="flex-1 border border-line rounded-full py-3 text-sm font-semibold">Kembali</button>
      <button data-action="submitCustomer" class="flex-1 bg-chili text-white font-bold rounded-full py-3 text-sm">Lanjut</button>
    </div>`;
}

function submitCustomer(){
  const name = $('nameInput').value.trim();
  if(name.length < 2 || name.length > 60){ showToast('Isi nama lengkap dulu (2-60 karakter)'); return; }
  customer = { name };
  saveProfile({ name });
  renderLocationStep();
}

/* ====== LOKASI ====== */
function useCurrentLocation(){
  if(!navigator.geolocation){ showToast('Perangkat tidak mendukung lokasi'); return; }
  navigator.geolocation.getCurrentPosition(
    pos => { $('addrInput').value = `Lokasi saat ini (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`; },
    () => showToast('Izin lokasi ditolak, isi alamat manual ya')
  );
}

function renderLocationStep(){
  $('drawerTitle').textContent = 'Lokasi Pengantaran';
  $('cartBody').innerHTML = `
    <div class="mb-4">
      <label class="text-sm font-semibold" for="addrInput">Alamat pengantaran</label>
      <textarea id="addrInput" rows="3" maxlength="300" placeholder="Nama jalan, nomor rumah, patokan..."
        class="w-full border border-line bg-card text-ink placeholder:text-inksoft/70 rounded-lg px-3 py-2.5 mt-1.5 text-sm resize-none"></textarea>
      <button data-action="useCurrentLocation" class="mt-2 text-xs font-semibold text-herb underline">Gunakan lokasi saat ini</button>
    </div>
    <div class="bg-card border border-line rounded-2xl p-4 text-xs text-inksoft">
      Kurir ditugaskan oleh admin setelah pesananmu diproses. Pantau statusnya di menu Riwayat.
    </div>`;
  $('cartFoot').innerHTML = `
    <div class="flex gap-3">
      <button data-action="renderCustomerStep" class="flex-1 border border-line rounded-full py-3 text-sm font-semibold">Kembali</button>
      <button data-action="confirmOrder" class="flex-1 bg-chili text-white font-bold rounded-full py-3 text-sm">Konfirmasi Pesanan</button>
    </div>`;
}

/* ====== KIRIM PESANAN (tanpa harga/total dari browser, anti dobel) ====== */
const SEND_TIMEOUT_MS = 10000;
const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject({ code: 'timeout' }), ms))
]);

async function orderAlreadyExists(ref){
  try{
    const snap = await withTimeout(getDocFromServer(ref), 6000);
    return snap.exists() && snap.data().customerId === currentUser.uid;
  }catch(e){ return false; }
}

function showSendError(message){
  let box = $('sendError');
  if(!box){
    box = document.createElement('div');
    box.id = 'sendError';
    box.className = 'mb-4 rounded-xl border border-chili bg-chili/15 px-4 py-3 text-sm';
    $('cartBody').prepend(box);
  }
  box.textContent = message;
}

async function confirmOrder(){
  if(isSubmitting) return;
  unlockAudio(); // harus dipanggil langsung dari klik

  const addr = ($('addrInput') ? $('addrInput').value : '').trim();
  if(addr.length < 5){ showToast('Isi alamat pengantaran dulu (minimal 5 karakter)'); return; }
  if(!currentUser || !currentUser.email || !currentUser.emailVerified){
    showToast('Sesi login habis, masuk lagi ya'); renderLoginStep(); return;
  }
  if(!customer.name){ showToast('Lengkapi data pemesan dulu'); renderCustomerStep(); return; }
  const items = { ...cart };
  const calc = calcOrder(items, subscribed);
  if(!calc.valid){ showToast('Keranjang tidak valid, cek jumlah pesanan'); renderCart(); return; }

  // ID dibuat sekali per isi pesanan → menekan ulang tidak membuat pesanan baru
  const sig = JSON.stringify([items, addr, payMethod, currentUser.email, subscribed]);
  if(!orderAttempt || orderAttempt.sig !== sig){
    const newRef = doc(collection(db, 'orders'));
    orderAttempt = { sig, ref: newRef, code: 'ORD-' + newRef.id.slice(0, 8).toUpperCase() };
  }
  const { ref, code } = orderAttempt;

  const data = {
    code,
    customerId: currentUser.uid,
    createdAt: serverTimestamp(),
    name: customer.name,
    email: currentUser.email,          // dari akun, dipaksa sama oleh Rules
    items,
    payment: payMethod,
    address: addr,
    discount: subscribed,
    status: 'Baru'
  };

  isSubmitting = true;
  const foot = $('cartFoot');
  const footBackup = foot.innerHTML;
  foot.innerHTML = `<button disabled class="w-full bg-chili/50 text-white font-bold rounded-full py-3 text-sm">Mengirim pesanan...</button>`;
  const oldErr = $('sendError');
  if(oldErr) oldErr.remove();

  let ok = false, lastErr = null;
  try{
    const batch = writeBatch(db);
    batch.set(ref, data);
    batch.set(doc(db, 'rate', currentUser.uid), { at: serverTimestamp() }); // pembatas 1 pesanan/60 detik
    await withTimeout(batch.commit(), SEND_TIMEOUT_MS);
    ok = true;
  }catch(err){
    lastErr = err;
    console.error('Gagal kirim pesanan:', err.code, err.message);
    ok = await orderAlreadyExists(ref); // mungkin sebenarnya sudah masuk
  }
  isSubmitting = false;

  if(!ok){
    foot.innerHTML = footBackup;
    let msg = 'Pesanan belum terkirim (' + ((lastErr && lastErr.code) || 'unknown') + '). Coba tekan "Konfirmasi Pesanan" lagi.';
    if(lastErr && lastErr.code === 'timeout') msg = 'Koneksi lambat, pesanan belum terkonfirmasi. Tekan "Konfirmasi Pesanan" lagi. Pesanan yang sama tidak akan terkirim dobel.';
    if(lastErr && lastErr.code === 'permission-denied') msg = 'Pesanan ditolak server. Kemungkinan terlalu cepat memesan lagi (tunggu 1 menit) atau data tidak valid.';
    showSendError(msg);
    showToast('Pesanan belum terkirim, coba lagi', 'error');
    return;
  }
  showOrderSuccess({ code, calc, address: addr, name: customer.name });
}

function showOrderSuccess(o){
  orderAttempt = null;
  cart = {}; // kosongkan sekarang, supaya tidak terpesan ulang
  render(); updateBadge();

  $('drawerTitle').textContent = 'Pesanan Berhasil';
  $('cartBody').innerHTML = `
    <div class="text-center py-8">
      <div class="mx-auto w-20 h-20 rounded-full bg-herb text-[#0d2420] flex items-center justify-center text-4xl font-bold shadow-[0_0_40px_rgba(55,230,201,0.45)]">✓</div>
      <h4 class="font-serif text-2xl mt-5">Pesanan berhasil dikirim!</h4>
      <p class="text-sm text-inksoft mt-2">Pesananmu sudah kami terima dan menunggu diproses admin.</p>
    </div>
    <div class="bg-card border border-line rounded-2xl p-4 text-sm">
      <div class="flex justify-between"><span class="text-inksoft">Kode pesanan</span><span class="font-semibold">${esc(o.code)}</span></div>
      <div class="flex justify-between mt-2"><span class="text-inksoft">Total</span><span class="font-bold text-chilidark">${money(o.calc.total)}</span></div>
      <div class="flex justify-between mt-2"><span class="text-inksoft">Atas nama</span><span>${esc(o.name)}</span></div>
      <div class="mt-2 text-inksoft">Dikirim ke</div>
      <div class="break-words">${esc(o.address)}</div>
    </div>`;
  $('cartFoot').innerHTML = `
    <button data-action="goToHistory" class="w-full border border-line rounded-full py-3 text-sm font-semibold mb-2">Lihat Riwayat</button>
    <button data-action="finishOrder" class="w-full bg-herb text-[#0d2420] font-bold rounded-full py-3 text-sm">Selesai</button>`;
  showToast('Pesanan berhasil dikirim! Kode ' + o.code, 'success');
  playSuccessSound();
}

function goToHistory(){ openHistory(); }
function finishOrder(){ closeCart(); render(); renderCart(); updateBadge(); }

/* ====== RIWAYAT (REALTIME DARI FIRESTORE, total dihitung ulang dari harga resmi) ====== */
const PAY_LABEL = { qris: 'QRIS', transfer: 'Transfer Bank', cod: 'Bayar di Tempat (COD)' };
const HISTORY_BADGE = {
  Baru: 'bg-chili text-white',
  Diproses: 'bg-[#ffb84d] text-[#2b1d00]',
  Dikirim: 'bg-[#6ea8ff] text-[#06162f]',
  Selesai: 'bg-herb text-[#0d2420]',
  Dibatalkan: 'bg-white/10 text-inksoft'
};

function stopHistoryListener(){ if(historyUnsub){ historyUnsub(); historyUnsub = null; } }

function historyCard(o){
  const c = calcOrder(o.items, o.discount === true);
  const status = HISTORY_BADGE[o.status] ? o.status : 'Baru';
  const date = o.date ? o.date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
  return `
    <div class="bg-card border border-line rounded-2xl p-4 mb-3">
      <div class="flex justify-between items-start gap-2">
        <div>
          <div class="font-semibold text-sm">${esc(o.id)}</div>
          <div class="text-xs text-inksoft">${esc(date)}</div>
        </div>
        <span class="text-[11px] font-semibold rounded-full px-2.5 py-1 ${HISTORY_BADGE[status]}">${esc(status)}</span>
      </div>
      <div class="mt-3 border-t border-line pt-2">
        ${c.lines.map(l => `
          <div class="flex justify-between text-xs py-0.5">
            <span>${esc(l.name)} <span class="text-inksoft">x${l.qty}</span></span>
            <span>${money(l.price * l.qty)}</span>
          </div>`).join('')}
      </div>
      <div class="flex justify-between text-xs text-inksoft mt-2"><span>Ongkir</span><span>${money(c.ongkir)}</span></div>
      <div class="flex justify-between font-bold text-sm mt-1"><span>Total</span><span class="text-chilidark">${money(c.total)}</span></div>
      <div class="text-xs text-inksoft mt-3">Bayar: ${esc(PAY_LABEL[o.payment] || o.payment)}</div>
      <div class="text-xs text-inksoft mt-0.5">Pemesan: ${esc(o.name)}</div>
      <div class="text-xs text-inksoft mt-0.5">Kurir: ${o.kurir ? esc(o.kurir) : 'Menunggu penugasan'}</div>
      <div class="text-xs text-inksoft mt-0.5 break-words">Alamat: ${esc(o.address)}</div>
    </div>`;
}

function renderHistoryList(orders, note){
  const noteHtml = note ? `<div class="mb-3 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-inksoft">${esc(note)}</div>` : '';
  $('cartBody').innerHTML = noteHtml + (orders.length
    ? orders.map(historyCard).join('')
    : `<div class="text-center text-inksoft text-sm py-16">Belum ada riwayat pesanan.<br>Pesanan yang sudah kamu konfirmasi akan muncul di sini.</div>`);
}

async function openHistory(){
  stopHistoryListener();
  awaitingLink = false;
  $('drawerTitle').textContent = 'Riwayat Pesanan';
  $('cartBody').innerHTML = `<div class="text-center text-inksoft text-sm py-16">Memuat riwayat...</div>`;
  $('cartFoot').innerHTML = `<button data-action="closeCart" class="w-full border border-line rounded-full py-3 text-sm font-semibold">Tutup</button>`;
  $('drawer').classList.remove('translate-x-full');
  $('overlay').classList.remove('opacity-0', 'pointer-events-none');

  await authReady;
  if(!drawerOpen()) return;

  if(!currentUser){
    $('cartBody').innerHTML = `<div class="text-center text-inksoft text-sm py-16">Masuk dulu lewat tombol "Bayar Sekarang" untuk melihat riwayat pesananmu.</div>`;
    return;
  }

  const q = query(collection(db, 'orders'), where('customerId', '==', currentUser.uid));
  historyUnsub = onSnapshot(q, snap => {
    const orders = snap.docs.map(d => {
      const x = d.data();
      return { ...x, id: x.code || d.id, date: x.createdAt ? x.createdAt.toDate() : null };
    }).sort((a, b) => (b.date || 0) - (a.date || 0));
    renderHistoryList(orders);
  }, err => {
    console.error('Gagal memuat riwayat:', err.code, err.message);
    renderHistoryList([], 'Riwayat belum bisa dimuat (' + err.code + '). Coba lagi sebentar.');
  });
}

/* ====== AKUN & LOGOUT ====== */
function maskEmail(e){
  const [u, d] = String(e || '').split('@');
  if(!d) return String(e || '');
  return (u.length > 2 ? u.slice(0, 2) : u.slice(0, 1)) + '•••@' + d;
}

function updateAccountBar(){
  const bar = $('accountBar');
  if(!bar) return;
  if(currentUser){
    $('accountText').textContent = 'Masuk sebagai ' + (currentUser.email ? maskEmail(currentUser.email) : 'akun');
    bar.classList.remove('hidden');
  }else{
    bar.classList.add('hidden');
  }
}

async function performLogout(message){
  closeCart();
  stopHistoryListener();
  clearInterval(linkTimer);
  awaitingLink = false;
  try{
    await signOut(auth);
  }catch(err){
    console.error('Gagal keluar:', err.code, err.message);
    showToast('Gagal keluar, coba lagi', 'error');
    return;
  }
  currentUser = null;
  subscribed = false;
  clearStoredData();
  cart = {};
  customer = { name: '' };
  loginEmail = ''; payMethod = '';
  orderAttempt = null;
  render(); renderCart(); updateBadge(); updateAccountBar(); updateSubBanner();
  showToast(message || 'Berhasil keluar', message ? 'info' : 'success');
}

function logout(){
  if(!currentUser) return;
  const hasCart = Object.keys(cart).length > 0;
  const msg = 'Keluar dari akun?\n\nData nama di tab ini akan dihapus.' + (hasCart ? '\nIsi keranjang juga akan dikosongkan.' : '');
  if(confirm(msg)) performLogout();
}

function openCart(){
  stopHistoryListener();
  awaitingLink = false;
  renderCart();
  $('drawer').classList.remove('translate-x-full');
  $('overlay').classList.remove('opacity-0', 'pointer-events-none');
}
function closeCart(){
  stopHistoryListener();
  $('drawer').classList.add('translate-x-full');
  $('overlay').classList.add('opacity-0', 'pointer-events-none');
}

/* ====== EVENT DELEGATION (pengganti onclick inline, kompatibel dengan CSP) ====== */
const ACTIONS = {
  openHistory, openCart, closeCart, logout, checkout, renderCart,
  renderLoginStep, sendLoginLink, resendLoginLink,
  useCurrentLocation, renderCustomerStep, submitCustomer,
  confirmOrder, finishOrder, goToHistory,
  setCat: (d) => setCat(d.cat),
  addItem: (d) => addItem(Number(d.id)),
  changeQty: (d) => changeQty(Number(d.id), Number(d.d)),
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if(!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.action];
  if(typeof fn === 'function') fn(el.dataset);
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Enter' && e.target.id === 'loginEmail') sendLoginLink();
});
$('search').addEventListener('input', render);

/* ====== MULAI ====== */
purgeLegacyLocalData();
renderTabs(); updateSubBanner(); render(); renderCart();
completeEmailLinkSignIn();