
const INITIAL_CASH = 10000;
const TRADE_ALLOCATION = 0.10;
const MAX_TRADE_VALUE = 1000;
const FEE_RATE = 0.001;

function createAccount() {
  return {
    cash: INITIAL_CASH,
    btc: 0,
    orders: []
  };
}

function executePaperOrder(account, { signal, price, orderId }) {
  if (!['BUY', 'SELL', 'HOLD'].includes(signal)) {
    throw new Error('Invalid signal');
  }

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Invalid market price');
  }

  if (signal === 'HOLD') {
    return { status: 'SKIPPED', reason: 'No trade signal' };
  }

  if (!orderId || typeof orderId !== 'string') {
    throw new Error('Valid order ID required');
  }

  if (account.orders.some(order => order.id === orderId)) {
    return { status: 'SKIPPED', reason: 'Duplicate order' };
  }

  let quantity;
  let value;
  let fee;

  if (signal === 'BUY') {
    if (account.btc > 0) {
      return { status: 'SKIPPED', reason: 'Position already open' };
    }

    value = Math.min(
      account.cash * TRADE_ALLOCATION,
      MAX_TRADE_VALUE
    );

    fee = value * FEE_RATE;

    if (value <= 0 || value + fee > account.cash) {
      return { status: 'SKIPPED', reason: 'Insufficient cash' };
    }

    quantity = value / price;
    account.cash -= value + fee;
    account.btc += quantity;
  } else {
    if (account.btc <= 0) {
      return { status: 'SKIPPED', reason: 'No position to sell' };
    }

    quantity = account.btc;
    value = quantity * price;
    fee = value * FEE_RATE;

    account.cash += value - fee;
    account.btc = 0;
  }

  const order = {
    id: orderId,
    market: 'BTC-USD',
    side: signal,
    price,
    quantity,
    value,
    fee,
    paperOnly: true
  };

  account.orders.push(order);

  return { status: 'FILLED_SIMULATED', order };
}

function getPortfolioValue(account, marketPrice) {
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
    throw new Error('Invalid valuation price');
  }

  return account.cash + account.btc * marketPrice;
}

function main() {
  const account = createAccount();

  const buy = executePaperOrder(account, {
    signal: 'BUY',
    price: 80000,
    orderId: 'test-buy-001'
  });

  const duplicate = executePaperOrder(account, {
    signal: 'BUY',
    price: 80000,
    orderId: 'test-buy-001'
  });

  const sell = executePaperOrder(account, {
    signal: 'SELL',
    price: 82000,
    orderId: 'test-sell-001'
  });

  console.log(JSON.stringify({
    mode: 'PAPER_ONLY_DRY_RUN',
    initialBalance: INITIAL_CASH,
    buy,
    duplicate,
    sell,
    finalCash: Number(account.cash.toFixed(2)),
    finalBtc: account.btc,
    portfolioValue: Number(
      getPortfolioValue(account, 82000).toFixed(2)
    ),
    simulatedOrders: account.orders.length,
    realOrdersExecuted: 0
  }, null, 2));
}

main();
