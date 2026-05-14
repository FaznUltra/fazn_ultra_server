export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // strip control characters
}

export function sanitizeStringArray(arr: string[]): string[] {
  return arr.map(sanitizeString);
}
