export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function formatDate(timestamp?: number): string {
  if (!timestamp) return 'Not set';
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

export function objectValues<T>(value: Record<string, T> | null | undefined): T[] {
  return value ? Object.values(value) : [];
}

export function safeExternalUrl(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS links are allowed.');
  }
  return parsed.toString();
}
