import { auth } from './firebase-config.js';

// const NOTIFY_URL = ' https://foody-notify.foody-app.workers.dev/notify';

const NOTIFY_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://localhost:8787/notify'
  : 'https://foody-notify.foody-app.workers.dev/notify';


export async function notifyAdmin(orderId){
  try{
    const user = auth.currentUser;
    if(!user) return;
    const token = await user.getIdToken();
    for(let i = 0; i < 2; i++){
      try{
        const res = await fetch(NOTIFY_URL, {
          method: 'POST',
          keepalive: true,
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
          body: JSON.stringify({ orderId }),
        });
        if(res.ok) return;
      }catch(e){ /* coba sekali lagi */ }
      await new Promise(r => setTimeout(r, 800));
    }
  }catch(e){ /* abaikan */ }
}

