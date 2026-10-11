import type {Candle} from './engine';
// Deterministic synthetic dataset, explicitly labeled as simulated.
export function sampleCandles(count=180):Candle[]{let price=100;return Array.from({length:count},(_,i)=>{price=Math.max(10,price+Math.sin(i/7)*1.2+Math.cos(i/17)*0.8+0.09);const d=new Date(Date.UTC(2026,0,1+i));return{date:d.toISOString().slice(0,10),close:Number(price.toFixed(2))}})}
