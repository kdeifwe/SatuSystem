export function normalizeKaspiPhone(raw: string): string {
  const digits = String(raw).replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return last10.length === 10 ? `7${last10}` : digits;
}

export function isValidKaspiPhone(raw: string): boolean {
  return /^[7]\d{10}$/.test(normalizeKaspiPhone(raw));
}
