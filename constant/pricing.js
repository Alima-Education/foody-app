import { MENU } from './food.js';

export const ONGKIR = 5000;
export const menuById = new Map(MENU.map(m => [String(m.id), m]));

export function unitPrice(item, discount){
  return (discount && item.cat === 'lunch') ? Math.round(item.price * 0.9) : item.price;
}

// items: { "1": 2, "5": 1 }  (id menu → jumlah). Data tak dikenal/di luar batas ditandai tidak valid.
export function calcOrder(items, discount){
  let subtotal = 0, valid = true;
  const lines = [];
  const entries = (items && typeof items === 'object') ? Object.entries(items) : [];
  for(const [id, rawQty] of entries){
    const m = menuById.get(String(id));
    const qty = Number(rawQty);
    if(!m || !Number.isInteger(qty) || qty < 1 || qty > 50){ valid = false; continue; }
    const price = unitPrice(m, discount);
    lines.push({ id: m.id, name: m.name, qty, price });
    subtotal += price * qty;
  }
  return { lines, subtotal, ongkir: ONGKIR, total: subtotal + ONGKIR, valid: valid && lines.length > 0 };
}