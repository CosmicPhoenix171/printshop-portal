import type { Material } from './types';

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function normalizedBalanceCents(summary?: { currentBalanceCents?: number; signConvention?: 'credit-positive' }): number {
  const balance = summary?.currentBalanceCents ?? 0;
  return summary?.signConvention === 'credit-positive' ? balance : -balance;
}

export function getTierRateCents(material: Material, grams: number, rates?: { smallRateCents?: number; mediumRateCents?: number; largeRateCents?: number; bulkRateCents?: number }): number {
  const defaults = material === 'PLA'
    ? { smallRateCents: 25, mediumRateCents: 15, largeRateCents: 10, bulkRateCents: 5 }
    : { smallRateCents: 30, mediumRateCents: 20, largeRateCents: 15, bulkRateCents: 10 };
  const effective = { ...defaults, ...rates };
  if (grams <= 50) return effective.smallRateCents;
  if (grams <= 200) return effective.mediumRateCents;
  if (grams < 500) return effective.largeRateCents;
  return effective.bulkRateCents;
}

export function calculateMaterialCostCents(material: Material, grams: number, wastePercent = 0, rates?: { smallRateCents?: number; mediumRateCents?: number; largeRateCents?: number; bulkRateCents?: number }): number {
  return Math.round(grams * (1 + wastePercent / 100) * getTierRateCents(material, grams, rates));
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
