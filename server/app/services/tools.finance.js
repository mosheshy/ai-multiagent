// backend/app/services/tools.finance.js

// Fake FX provider (replace with a real API later)
export async function fxGetRate(base = "USD", quote = "ILS") {
  // In real code, call exchangerate.host / your provider.
  // Here we return a deterministic stub so demos don't break offline.
  const mock = { USDILS: 3.6, EURILS: 3.85, USDEUR: 0.93 };
  const key = (base + quote).toUpperCase();
  const rate = mock[key] ?? 3.6;
  return { ok: true, base, quote, rate, ts: new Date().toISOString() };
}

// Basic fee calc: percent fee with minimum flat fee
export function calcFees({ amount, percent = 0.25, min = 2 }) {
  const percFee = (amount * percent) / 100;
  const total = Math.max(percFee, min);
  return { amount, percent, min, percFee: +percFee.toFixed(2), total: +total.toFixed(2) };
}
