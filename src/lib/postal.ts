export function formatPostalCode(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 7);
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

export function postalDigits(raw: string) {
  return raw.replace(/\D/g, '').slice(0, 7);
}

export async function lookupPostalAddress(raw: string) {
  const zip = postalDigits(raw);
  if (zip.length !== 7) return { address: '', error: '郵便番号は7桁で入力してください。' };
  const response = await fetch(`/api/postal?zip=${encodeURIComponent(zip)}`);
  const data = (await response.json().catch(() => ({}))) as { address?: string; error?: string };
  if (!response.ok || !data.address) {
    return { address: '', error: data.error || '住所を取得できませんでした。' };
  }
  return { address: data.address, error: '' };
}
