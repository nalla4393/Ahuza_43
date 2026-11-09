type Rate = { usdPerInr: number; date: string };
let cache: { rate: Rate; fetchedAt: number } | undefined;

export function parseExchangeRate(value: unknown, now = Date.now()): Rate {
  if (!value || typeof value !== 'object') throw new Error('Invalid exchange rate response');
  const data = value as { base?: unknown; date?: unknown; rates?: { USD?: unknown } };
  if (data.base !== 'INR' || typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
      || typeof data.rates?.USD !== 'number' || !Number.isFinite(data.rates.USD) || data.rates.USD <= 0) {
    throw new Error('Invalid exchange rate response');
  }
  const age = now - Date.parse(`${data.date}T00:00:00Z`);
  if (!Number.isFinite(age) || age < 0 || age > 7 * 86400000) throw new Error('Exchange rate is stale or invalid');
  return { usdPerInr: data.rates.USD, date: data.date };
}

export async function getExchangeRate(): Promise<Rate> {
  if (cache && Date.now() - cache.fetchedAt < 3600000) return parseExchangeRate({ base: 'INR', date: cache.rate.date, rates: { USD: cache.rate.usdPerInr } });
  const response = await fetch('https://api.frankfurter.dev/v1/latest?base=INR&symbols=USD', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Exchange rate provider returned ${response.status}`);
  const rate = parseExchangeRate(await response.json());
  cache = { rate, fetchedAt: Date.now() };
  return rate;
}
