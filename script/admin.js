import { auth, db } from './firebase-admin-config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { collection, query, orderBy, limit, onSnapshot, doc, getDoc, writeBatch, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { calcOrder } from '../constant/pricing.js';

const STATUSES = ['Baru', 'Diproses', 'Dikirim', 'Selesai', 'Dibatalkan'];
const NEXT = { Baru: 'Diproses', Diproses: 'Dikirim', Dikirim: 'Selesai' };
const NEXT_LABEL = { Baru: 'Proses pesanan', Diproses: 'Tandai dikirim', Dikirim: 'Tandai selesai' };
const BADGE = {
  Baru: 'bg-chili text-white',
  Diproses: 'bg-[#ffb84d] text-[#2b1d00]',
  Dikirim: 'bg-[#6ea8ff] text-[#06162f]',
  Selesai: 'bg-herb text-[#0d2420]',
  Dibatalkan: 'bg-white/10 text-inksoft'
};
const PAY_LABEL = { qris: 'QRIS', transfer: 'Transfer Bank', cod: 'Bayar di Tempat (COD)' };
const KURIR = [
  { name: 'Budi Santoso', kend: 'Harley Davidson', plat: 'B 3421 AXQ' },
  { name: 'Andi Firmansyah', kend: 'Mclaren senna', plat: 'B 87 CVR' },
  { name: 'Sari Wulandari', kend: 'Bmw m4', plat: 'B 550 DZK' },
];
const ID_RE = /^[A-Za-z0-9]{20}$/;       // ID dokumen pesanan
const UID_RE = /^[A-Za-z0-9]{20,40}$/;   // UID pelanggan

const $ = (id) => document.getElementById(id);
const money = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let orders = [];
let subscriberIds = new Set();
let activeStatus = 'Semua';
let unsubOrders = null, unsubSubs = null;
let firstLoad = true;
let loginMessage = '';

/* ====== TOAST ====== */
const TOAST_STYLE = {
  success: { cls: 'bg-herb text-[#0d2420] border-herb', icon: '✓' },
  error:   { cls: 'bg-chili text-white border-chili',   icon: '!' },
  info:    { cls: 'bg-surface text-ink border-white/30', icon: 'i' },
};
function showToast(msg, type = 'info'){
  const s = TOAST_STYLE[type];
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
  }, type === 'error' ? 4500 : 3000);
}

/* ====== SUARA PESANAN BARU ====== */
let audioCtx = null;
function unlockAudio(){
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    if(!audioCtx) audioCtx = new AC();
    if(audioCtx.state === 'suspended') audioCtx.resume();
  }catch(e){}
}
function playNewOrderSound(){
  try{
    unlockAudio();
    if(!audioCtx) return;
    const now = audioCtx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.5);
    });
  }catch(e){ console.warn('Suara gagal diputar:', e); }
}
document.addEventListener('click', unlockAudio, { once: true });

/* ====== LOGIN / LOGOUT / SESI ====== */
function showLogin(){
  $('panelView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  $('loginError').textContent = loginMessage;
  loginMessage = '';
}
function showPanel(){
  $('loginView').classList.add('hidden');
  $('panelView').classList.remove('hidden');
}

async function doLogin(){
  unlockAudio();
  const email = $('loginEmail').value.trim();
  const pass = $('loginPass').value;
  if(!email || !pass){ $('loginError').textContent = 'Isi email dan password.'; return; }
  $('loginBtn').disabled = true;
  $('loginError').textContent = '';
  try{
    await signInWithEmailAndPassword(auth, email, pass);
    $('loginPass').value = '';
  }catch(err){
    console.error('Login gagal:', err.code, err.message);
    $('loginError').textContent = (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found')
      ? 'Email atau password salah.'
      : err.code === 'auth/too-many-requests'
        ? 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.'
        : 'Gagal masuk. Coba lagi.';
  }finally{
    $('loginBtn').disabled = false;
  }
}

// logout otomatis saat tidak aktif (15 menit)
const IDLE_MS = 15 * 60 * 1000;
let lastActivity = Date.now();
['click', 'keydown', 'touchstart', 'input'].forEach(ev =>
  document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
setInterval(() => {
  if(auth.currentUser && Date.now() - lastActivity > IDLE_MS){
    loginMessage = 'Sesi berakhir karena tidak aktif.';
    signOut(auth);
  }
}, 30000);

function stopListening(){
  if(unsubOrders){ unsubOrders(); unsubOrders = null; }
  if(unsubSubs){ unsubSubs(); unsubSubs = null; }
}

onAuthStateChanged(auth, async (user) => {
  if(!user){
    stopListening();
    orders = [];
    subscriberIds = new Set();
    showLogin();
    return;
  }
  try{
    const snap = await getDoc(doc(db, 'admins', user.uid));
    if(snap.exists()){
      lastActivity = Date.now();
      showPanel();
      startListening();
    }else{
      loginMessage = 'Akun ini bukan admin.';
      await signOut(auth);
    }
  }catch(err){
    console.error('Verifikasi admin gagal:', err.code, err.message);
    loginMessage = 'Gagal verifikasi admin.';
    await signOut(auth);
  }
});

/* ====== DATA (REALTIME) ====== */
function startListening(){
  stopListening();
  firstLoad = true;
  unsubOrders = onSnapshot(
    query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(300)),
    snap => {
      orders = snap.docs.filter(d => ID_RE.test(d.id)).map(d => ({ docId: d.id, ...d.data() }));
      if(!firstLoad){
        const added = snap.docChanges().filter(c => c.type === 'added' && !c.doc.metadata.hasPendingWrites);
        if(added.length){
          showToast(added.length === 1
            ? 'Pesanan baru masuk: ' + (added[0].doc.data().code || '')
            : added.length + ' pesanan baru masuk', 'success');
          playNewOrderSound();
        }
      }
      firstLoad = false;
      render();
    },
    err => {
      console.error('Gagal memuat pesanan:', err.code, err.message);
      showToast('Gagal memuat pesanan: ' + err.code, 'error');
    }
  );
  unsubSubs = onSnapshot(collection(db, 'subscribers'),
    snap => { subscriberIds = new Set(snap.docs.map(d => d.id)); render(); },
    err => console.error('Gagal memuat langganan:', err.code));
}

const toDate = (o) => (o.createdAt && o.createdAt.toDate) ? o.createdAt.toDate() : null;

// total SELALU dihitung ulang dari harga resmi, bukan dari data pelanggan
function view(o){
  return { ...o, calc: calcOrder(o.items, o.discount === true), status: STATUSES.includes(o.status) ? o.status : 'Baru' };
}

/* ====== AKSI ADMIN (dicatat di auditLogs) ====== */
function auditEntry(target, from, to){
  return { target, from, to, by: auth.currentUser.uid, at: serverTimestamp() };
}

async function commitStatus(o, patch){
  try{
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', o.docId), patch);
    batch.set(doc(collection(db, 'auditLogs')), auditEntry(o.docId, o.status, patch.status));
    await batch.commit();
    showToast('Status diubah: ' + patch.status, 'success');
  }catch(err){
    console.error('Gagal ubah status:', err.code, err.message);
    showToast('Gagal ubah status: ' + err.code, 'error');
  }
}

function advance(ds, el){
  const o = orders.find(x => x.docId === ds.id);
  if(!o || NEXT[o.status] !== ds.to) return;
  const patch = { status: ds.to };
  if(o.status === 'Baru'){
    const sel = el.closest('[data-card]').querySelector('select');
    const k = KURIR.find(x => sel && x.plat === sel.value);
    if(!k){ showToast('Pilih kurir dulu', 'error'); return; }
    patch.kurir = `${k.name} (${k.kend}, ${k.plat})`;
  }
  commitStatus(o, patch);
}

function cancelOrder(ds){
  const o = orders.find(x => x.docId === ds.id);
  if(o && confirm('Batalkan pesanan ini?')) commitStatus(o, { status: 'Dibatalkan' });
}

async function toggleSub(ds){
  const uid = ds.uid;
  if(!UID_RE.test(uid)) return;
  const has = subscriberIds.has(uid);
  if(!confirm(has ? 'Cabut langganan pelanggan ini?' : 'Aktifkan langganan (diskon 10% menu lunch) untuk pelanggan ini?')) return;
  try{
    const batch = writeBatch(db);
    const ref = doc(db, 'subscribers', uid);
    if(has) batch.delete(ref);
    else batch.set(ref, { since: serverTimestamp(), by: auth.currentUser.uid });
    batch.set(doc(collection(db, 'auditLogs')), auditEntry('sub:' + uid, has ? 'Langganan' : 'Biasa', has ? 'Biasa' : 'Langganan'));
    await batch.commit();
    showToast(has ? 'Langganan dicabut' : 'Langganan diaktifkan', 'success');
  }catch(err){
    console.error('Gagal ubah langganan:', err.code, err.message);
    showToast('Gagal ubah langganan: ' + err.code, 'error');
  }
}

/* ====== RENDER (semua data pelanggan lewat esc(); angka lewat calcOrder) ====== */
function renderStats(list){
  const todayStr = new Date().toDateString();
  const today = list.filter(o => {
    const d = toDate(o);
    return o.calc.valid && d && d.toDateString() === todayStr && o.status !== 'Dibatalkan';
  });
  const omzet = today.reduce((sum, o) => sum + o.calc.total, 0);
  const baru = list.filter(o => o.status === 'Baru').length;
  const card = (label, value, accent) => `
    <div class="bg-card border border-line rounded-2xl p-3">
      <div class="text-[11px] text-inksoft">${label}</div>
      <div class="font-bold text-base mt-0.5 ${accent || ''}">${value}</div>
    </div>`;
  $('stats').innerHTML =
    card('Pesanan baru', baru, 'text-chilidark') +
    card('Pesanan hari ini', today.length) +
    card('Omzet hari ini', money(omzet), 'text-herb');
}

function renderTabs(list){
  $('tabs').innerHTML = ['Semua', ...STATUSES].map(s => {
    const n = s === 'Semua' ? list.length : list.filter(o => o.status === s).length;
    const on = s === activeStatus;
    return `<button data-action="setTab" data-tab="${esc(s)}"
      class="flex-none rounded-full border text-sm font-semibold px-4 py-1.5 ${on ? 'bg-chili text-white border-chili' : 'bg-card text-inksoft border-line'}">${esc(s)} <span class="opacity-70">${n}</span></button>`;
  }).join('');
}

function orderCard(o){
  const d = toDate(o);
  const next = NEXT[o.status];
  const canCancel = o.status === 'Baru' || o.status === 'Diproses';
  const isSub = subscriberIds.has(o.customerId);

  const kurirSelect = o.status === 'Baru' ? `
    <select class="w-full mt-3 border border-line bg-surface text-ink rounded-lg px-3 py-2 text-xs" aria-label="Pilih kurir">
      <option value="">Pilih kurir...</option>
      ${KURIR.map(k => `<option value="${esc(k.plat)}">${esc(k.name)} · ${esc(k.kend)}</option>`).join('')}
    </select>` : '';

  const actions = (next || canCancel) ? `
    ${kurirSelect}
    <div class="flex gap-2 mt-3">
      ${next ? `<button data-action="advance" data-id="${esc(o.docId)}" data-to="${esc(next)}" class="flex-1 bg-chili text-white font-bold rounded-full py-2.5 text-xs">${NEXT_LABEL[o.status]}</button>` : ''}
      ${canCancel ? `<button data-action="cancelOrder" data-id="${esc(o.docId)}" class="flex-1 border border-line rounded-full py-2.5 text-xs font-semibold">Batalkan</button>` : ''}
    </div>` : '';

  const subBtn = UID_RE.test(String(o.customerId || '')) ? `
    <button data-action="toggleSub" data-uid="${esc(o.customerId)}" class="mt-3 text-xs font-semibold text-herb underline">
      ${isSub ? 'Cabut langganan pelanggan' : 'Aktifkan langganan pelanggan'}</button>` : '';

  return `
  <div data-card class="bg-card border border-line rounded-2xl p-4">
    <div class="flex justify-between items-start gap-2">
      <div>
        <div class="font-semibold text-sm">${esc(o.code || o.docId)}</div>
        <div class="text-xs text-inksoft">${d ? esc(d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })) : '-'}</div>
      </div>
      <div class="flex flex-col items-end gap-1">
        <span class="text-[11px] font-semibold rounded-full px-2.5 py-1 ${BADGE[o.status]}">${esc(o.status)}</span>
        ${o.calc.valid ? '' : '<span class="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-chili text-white">Data tidak valid</span>'}
      </div>
    </div>

    <div class="mt-3">
      <div class="font-semibold text-sm">${esc(o.name || '-')}</div>
      <div class="text-xs text-inksoft break-words">${esc(o.phone || '-')} · ${esc(o.email || '-')}</div>
      <div class="text-[11px] text-inksoft/70">Email dari pelanggan, belum diverifikasi server.</div>
    </div>

    <div class="mt-3 border-t border-line pt-2">
      ${o.calc.lines.map(l => `
        <div class="flex justify-between text-xs py-0.5">
          <span>${esc(l.name)} <span class="text-inksoft">x${l.qty}</span></span>
          <span>${money(l.price * l.qty)}</span>
        </div>`).join('')}
    </div>
    ${o.discount === true ? '<div class="text-xs text-herb mt-1">Diskon langganan 10% (menu lunch)</div>' : ''}
    <div class="flex justify-between text-xs text-inksoft mt-2"><span>Ongkir</span><span>${money(o.calc.ongkir)}</span></div>
    <div class="flex justify-between font-bold text-sm mt-1"><span>Total (dihitung ulang)</span><span class="text-chilidark">${money(o.calc.total)}</span></div>

    <div class="text-xs text-inksoft mt-3">Bayar: ${esc(PAY_LABEL[o.payment] || o.payment || '-')}</div>
    <div class="text-xs text-inksoft mt-0.5">Kurir: ${o.kurir ? esc(o.kurir) : 'Belum ditugaskan'}</div>
    <div class="text-xs text-inksoft mt-0.5 break-words">Alamat: ${esc(o.address || '-')}</div>
    ${actions}
    ${subBtn}
  </div>`;
}

function render(){
  const q = $('search').value.trim().toLowerCase();
  const list = orders.map(view);
  const filtered = list.filter(o =>
    (activeStatus === 'Semua' || o.status === activeStatus) &&
    (!q || [o.code, o.name, o.email, o.phone, o.address].some(v => String(v ?? '').toLowerCase().includes(q)))
  );
  $('countText').textContent = filtered.length + ' pesanan' + (filtered.length !== list.length ? ' (dari ' + list.length + ')' : '') + ' · 300 terbaru';
  renderStats(list);
  renderTabs(list);
  $('list').innerHTML = filtered.length
    ? filtered.map(orderCard).join('')
    : `<p class="md:col-span-2 text-center text-inksoft text-sm py-16">Belum ada pesanan yang cocok.</p>`;
}

/* ====== EVENT (tanpa onclick inline) ====== */
const ACTIONS = {
  setTab: (d) => { if(d.tab === 'Semua' || STATUSES.includes(d.tab)){ activeStatus = d.tab; render(); } },
  advance, cancelOrder, toggleSub,
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if(!el) return;
  const fn = ACTIONS[el.dataset.action];
  if(typeof fn === 'function') fn(el.dataset, el);
});
$('loginBtn').addEventListener('click', doLogin);
$('loginPass').addEventListener('keydown', e => { if(e.key === 'Enter') doLogin(); });
$('logoutBtn').addEventListener('click', () => signOut(auth));
$('search').addEventListener('input', render);