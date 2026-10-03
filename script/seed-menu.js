// seed-menu.js
import { db } from "./firebase-config.js";
import { collection, addDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const MENU_SEED = [
  {name:'Chicken Katsu',category:'lunch',price:32000,desc:'Ayam crispy, saus katsu',available:true},
  {name:'Nasi Goreng',category:'lunch',price:16000,desc:'Bumbu rumahan, telur mata sapi',available:true},
  {name:'Mie Goreng',category:'lunch',price:14000,desc:'Mie kenyal, sayur segar',available:true},
  {name:'Dimsum (6 pcs)',category:'lunch',price:12000,desc:'Isi ayam, saus sambal',available:true},
  {name:'Ricebowl Ayam Teriyaki',category:'lunch',price:27000,desc:'Nasi hangat, saus teriyaki',available:true},
  {name:'Ricebowl Ayam Geprek',category:'lunch',price:27000,desc:'Sambal bawang pedas',available:true},
  {name:'Cupcake (3 pcs)',category:'dessert',price:9000,desc:'Lembut, topping krim',available:true},
  {name:'Bolu Coklat (5 pcs)',category:'dessert',price:10000,desc:'Coklat lumer di dalam',available:true},
  {name:'Es Teh Manis/Tawar',category:'drink',price:5000,desc:'Segar, pilih manis atau tawar',available:true},
  {name:'Es Jeruk',category:'drink',price:7000,desc:'Jeruk peras asli',available:true},
];

async function seed(){
  for(const item of MENU_SEED){
    await addDoc(collection(db, "menu"), item);
    console.log("Ditambahkan:", item.name);
  }
  console.log("Selesai seeding menu.");
}
seed();