export function decimalString(value: unknown, fallback = '0'): string {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'object' && value && 'toString' in value) {
    return String(value.toString());
  }

  return fallback;
}

export function toNumber(value: unknown, fallback = 0): number {
  const stringValue = decimalString(value, '');
  const parsed = Number.parseFloat(stringValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
