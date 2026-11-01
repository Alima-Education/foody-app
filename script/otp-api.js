import { OTP_CONFIG } from './otp-config.js';

async function otpCall(path, body){
  let res;
  try{
    res = await fetch(`${OTP_CONFIG.baseUrl}/otp/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': OTP_CONFIG.apiKey,
      },
      body: JSON.stringify({ ...body, purpose: OTP_CONFIG.purpose }),
    });
  }catch{
    // server mati, salah alamat, atau diblokir CORS
    return { ok: false, code: 'NETWORK', status: 0 };
  }
  const data = await res.json().catch(() => ({}));
  return { ...data, ok: res.ok && data.ok === true, status: res.status };
}

export const requestOtp = (email) => otpCall('request', { email });
export const verifyOtp = (email, code) => otpCall('verify', { email, code });

export function otpErrorMessage(r){
  if(r.code === 'NETWORK') return 'Server OTP tidak bisa dihubungi.';
  if(r.status === 401) return 'API key salah, cek otp-config.js.';
  if(r.code === 'COOLDOWN') return `Tunggu ${r.retryAfterSeconds} detik sebelum minta kode lagi.`;
  if(r.status === 429) return 'Terlalu banyak permintaan, coba lagi sebentar.';
  if(r.code === 'INVALID') return 'Kode salah.';
  if(r.code === 'EXPIRED') return 'Kode kedaluwarsa. Kirim ulang kode.';
  if(r.code === 'TOO_MANY_ATTEMPTS') return 'Terlalu banyak salah. Kirim ulang kode.';
  if(r.status === 502) return 'Email gagal terkirim, coba lagi.';
  if(r.status === 400) return r.error ?? 'Input tidak valid.';
  return 'Terjadi kesalahan.';
}