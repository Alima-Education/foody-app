export const MENU = [
  {id:1,cat:'lunch',name:'Chicken Katsu',price:32000,desc:'Ayam crispy, saus katsu'},
  {id:2,cat:'lunch',name:'Nasi Goreng',price:16000,desc:'Bumbu rumahan, telur mata sapi'},
  {id:3,cat:'lunch',name:'Mie Goreng',price:14000,desc:'Mie kenyal, sayur segar'},
  {id:4,cat:'lunch',name:'Dimsum (6 pcs)',price:12000,desc:'Isi ayam, saus sambal'},
  {id:5,cat:'lunch',name:'Ricebowl Ayam Teriyaki',price:27000,desc:'Nasi hangat, saus teriyaki'},
  {id:6,cat:'lunch',name:'Ricebowl Ayam Geprek',price:27000,desc:'Sambal bawang pedas'},
  {id:7,cat:'dessert',name:'Cupcake (3 pcs)',price:9000,desc:'Lembut, topping krim'},
  {id:8,cat:'dessert',name:'Bolu Coklat (5 pcs)',price:10000,desc:'Coklat lumer di dalam'},
  {id:9,cat:'drink',name:'Es Teh Manis/Tawar',price:5000,desc:'Segar, pilih manis atau tawar'},
  {id:10,cat:'drink',name:'Es Jeruk',price:7000,desc:'Jeruk peras asli'},
];
export const CATS = [['all','Semua'],['lunch','Lunch'],['dessert','Dessert'],['drink','Minuman']];
export function money(n){ return 'Rp' + n.toLocaleString('id-ID'); }