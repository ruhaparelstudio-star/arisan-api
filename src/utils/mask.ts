export function maskPhone(phone: string): string {
  if (phone.length < 4) return '****';
  return `+62 8xx-xxxx-${phone.slice(-4)}`;
}
