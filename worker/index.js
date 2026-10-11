import 'dotenv/config';
import pg from 'pg';

const env = process.env;
if (env.PAPER_ONLY !== 'true') throw new Error('Safety lock: PAPER_ONLY must equal true');
if (!env.DATABASE_URL) throw new Error('DATABASE_URL missing');
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 3, ssl: env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: true } });
const interval = Math.max(60, Number(env.BOT_INTERVAL_SECONDS || 300));
const maxAllocation = Math.min(0.1, Math.max(0, Number(env.MAX_POSITION_PCT || 0.1)));
const dailyLoss = Math.min(0.02, Math.max(0, Number(env.MAX_DAILY_LOSS_PCT || 0.02)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sma = (xs, n) => xs.slice(-n).reduce((a,b) => a+b,0)/n;
const toNum = x => Number(x);

async function candles(market, symbol) {
  if (market === 'BINANCE') {
    if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error('Invalid Binance symbol');
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=45`;
    const r = await fetch(url, {signal: AbortSignal.timeout(10000)});
    if (!r.ok) throw new Error(`Binance HTTP ${r.status}`);
    const rows = await r.json();
    return rows.slice(0,-1).map(x=>({t:Number(x[6]),c:Number(x[4]),v:Number(x[5])}));
  }
  if (market === 'US') {
    if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY) throw new Error('Alpaca data credentials missing');
    if (!/^[A-Z.]{1,8}$/.test(symbol)) throw new Error('Invalid US symbol');
    const url = `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Hour&limit=45&adjustment=raw&feed=iex`;
    const r = await fetch(url,{headers:{'APCA-API-KEY-ID':env.ALPACA_KEY_ID,'APCA-API-SECRET-KEY':env.ALPACA_SECRET_KEY},signal:AbortSignal.timeout(10000)});
    if (!r.ok) throw new Error(`Alpaca HTTP ${r.status}`);
    const j=await r.json();
    return (j.bars||[]).map(x=>({t:Date.parse(x.t),c:Number(x.c),v:Number(x.v)}));
  }
  // Do not use unofficial scraped PSX prices or fabricated candles.
  throw new Error('PSX adapter intentionally disabled pending licensed market-data provider');
}
function marketOpen(market, now=new Date()) {
  if(market==='BINANCE') return true;
  // Conservative US regular-hours gate; daylight savings via NY local clock.
  if(market==='US') {
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(x=>[x.type,x.value]));
    const mins=Number(parts.hour)*60+Number(parts.minute);
    return !['Sat','Sun'].includes(parts.weekday) && mins>=570 && mins<960;
  }
  return false; // PSX calendar/holidays must be integrated before enabling.
}
async function event(market,symbol,level,message) {
  await pool.query('insert into public.bot_events(market,symbol,level,message) values($1,$2,$3,$4)',[market,symbol,level,String(message).slice(0,500)]);
}
async function runMarket(market,symbol) {
  if(!marketOpen(market)) return;
  const bars=await candles(market,symbol);
  if(bars.length<32 || bars.some(x=>!Number.isFinite(x.c)||x.c<=0)) throw new Error('Insufficient or invalid bars');
  const last=bars.at(-1);
  const freshness=market==='BINANCE'?2*3600000:4*3600000;
  if(Date.now()-last.t>freshness || last.t>Date.now()+60000) throw new Error('Stale or future market data');
  const prev=bars.slice(0,-1).map(x=>x.c), curr=bars.map(x=>x.c);
  const wasFast=sma(prev,10),wasSlow=sma(prev,30),isFast=sma(curr,10),isSlow=sma(curr,30);
  const side=wasFast<=wasSlow&&isFast>isSlow?'BUY':wasFast>=wasSlow&&isFast<isSlow?'SELL':null;
  if(!side) return;
  const client=await pool.connect();
  try {
    await client.query('begin');
    const settings=await client.query("select enabled,paper_only from public.bot_settings where id='global' for update");
    if(!settings.rows[0]?.enabled || !settings.rows[0]?.paper_only) {await client.query('rollback');return;}
    const currency=market==='PSX'?'PKR':'USD';
    const initial=market==='PSX'?Number(env.PAPER_START_PKR||1000000):Number(env.PAPER_START_USD||10000);
    await client.query('insert into public.paper_accounts(market,currency,cash,starting_cash) values($1,$2,$3,$3) on conflict do nothing',[market,currency,initial]);
    const acc=(await client.query('select * from public.paper_accounts where market=$1 for update',[market])).rows[0];
    const pos=(await client.query('select * from public.paper_positions where market=$1 and symbol=$2 for update',[market,symbol])).rows[0];
    const owned=toNum(pos?.quantity||0),price=last.c;
    const quantity=side==='BUY'?Math.floor((toNum(acc.cash)*maxAllocation)/price*1e6)/1e6:owned;
    if(quantity<=0 || (side==='BUY'&&quantity*price>toNum(acc.cash))) {await client.query('rollback');return;}
    // Simple conservative daily-loss guard based on realized cash and marked-to-market current position.
    const equity=toNum(acc.cash)+owned*price;
    if(equity<toNum(acc.starting_cash)*(1-dailyLoss)) {await client.query('rollback');await event(market,symbol,'WARN','Daily-loss safety threshold: trading paused');return;}
    const key=`${market}:${symbol}:${side}:${last.t}`;
    const inserted=await client.query('insert into public.paper_orders(idempotency_key,market,symbol,side,quantity,fill_price,source) values($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning id',[key,market,symbol,side,quantity,price,'SMA_10_30']);
    if(!inserted.rowCount){await client.query('rollback');return;}
    const newCash=toNum(acc.cash)+(side==='BUY'?-1:1)*quantity*price;
    const newQty=owned+(side==='BUY'?1:-1)*quantity;
    const avg=side==='BUY'?((owned*toNum(pos?.avg_price||0)+quantity*price)/newQty):(newQty?toNum(pos?.avg_price||0):0);
    await client.query('update public.paper_accounts set cash=$2,updated_at=now() where market=$1',[market,newCash]);
    await client.query('insert into public.paper_positions(market,symbol,quantity,avg_price) values($1,$2,$3,$4) on conflict(market,symbol) do update set quantity=$3,avg_price=$4',[market,symbol,newQty,avg]);
    await client.query('insert into public.bot_events(market,symbol,level,message) values($1,$2,$3,$4)',[market,symbol,'INFO',`PAPER ${side} ${quantity} @ ${price}`]);
    await client.query('commit');
  } catch(e){await client.query('rollback');throw e;} finally{client.release();}
}
async function cycle(){
  if(env.BOT_ENABLED!=='true') return;
  for(const [market,symbol,flag] of [['BINANCE',env.BINANCE_SYMBOL||'BTCUSDT','ENABLE_BINANCE'],['US',env.US_SYMBOL||'AAPL','ENABLE_US'],['PSX',env.PSX_SYMBOL||'OGDC','ENABLE_PSX']]){
    if(env[flag]!=='true')continue;
    try{await runMarket(market,symbol);}catch(e){console.error(market,e.message);try{await event(market,symbol,'ERROR',e.message);}catch{}}
  }
}
console.log('Paper-only worker started; enabled:',env.BOT_ENABLED==='true');
while(true){await cycle();await sleep(interval*1000);}
