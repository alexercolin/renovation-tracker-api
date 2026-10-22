const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatUsd(cents: number): string {
  return usd.format(cents / 100);
}
