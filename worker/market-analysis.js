
const PRODUCT = 'BTC-USD';
const GRANULARITY = 3600; // 1-hour candles
const FAST_PERIOD = 10;
const SLOW_PERIOD = 30;

function calculateSMA(prices, period) {
  if (prices.length < period) {
    throw new Error('Not enough price data');
  }

  const recent = prices.slice(-period);
  const sum = recent.reduce((total, price) => total + price, 0);

  return sum / period;
}

async function fetchMarketData() {
  const url =
    `https://api.exchange.coinbase.com/products/${PRODUCT}/candles` +
    `?granularity=${GRANULARITY}`;

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Market data request failed: ${response.status}`);
  }

  const candles = await response.json();

  if (!Array.isArray(candles)) {
    throw new Error('Unexpected market data response');
  }

  const currentCandleStart =
    Math.floor(Date.now() / 1000 / GRANULARITY) * GRANULARITY;

  return candles
    .filter(candle =>
      Array.isArray(candle) &&
      candle.length >= 5 &&
      Number(candle[0]) < currentCandleStart &&
      Number.isFinite(Number(candle[4])) &&
      Number(candle[4]) > 0
    )
    .sort((a, b) => a[0] - b[0])
    .map(candle => ({
      time: Number(candle[0]),
      close: Number(candle[4])
    }));
}

async function main() {
  const candles = await fetchMarketData();
  const prices = candles.map(candle => candle.close);

  if (prices.length < SLOW_PERIOD + 1) {
    throw new Error('Insufficient completed candles');
  }

  const fastSMA = calculateSMA(prices, FAST_PERIOD);
  const slowSMA = calculateSMA(prices, SLOW_PERIOD);

  const previousFast = calculateSMA(
    prices.slice(0, -1),
    FAST_PERIOD
  );

  const previousSlow = calculateSMA(
    prices.slice(0, -1),
    SLOW_PERIOD
  );

  let signal = 'HOLD';

  if (previousFast <= previousSlow && fastSMA > slowSMA) {
    signal = 'BUY';
  } else if (
    previousFast >= previousSlow &&
    fastSMA < slowSMA
  ) {
    signal = 'SELL';
  }

  console.log(JSON.stringify({
    market: PRODUCT,
    timeframe: '1h',
    lastClosedCandle: new Date(
      candles[candles.length - 1].time * 1000
    ).toISOString(),
    price: prices[prices.length - 1],
    sma10: Number(fastSMA.toFixed(2)),
    sma30: Number(slowSMA.toFixed(2)),
    signal,
    mode: 'ANALYSIS_ONLY',
    ordersExecuted: 0
  }, null, 2));
}

main().catch(error => {
  console.error('Market analysis failed:', error.message);
  process.exitCode = 1;
});
