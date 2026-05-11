/**
 * Sanitize a URL to prevent XSS via javascript:, data:, vbscript: protocols.
 * Only allows http:, https:, mailto:, tel: protocols.
 * Returns '#' for invalid/dangerous URLs.
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '#';

  const trimmed = url.trim();
  if (!trimmed) return '#';

  // Decode and check for dangerous protocols (case-insensitive, handles whitespace tricks)
  const normalized = trimmed.replace(/[\s\x00-\x1f]/g, '').toLowerCase();

  const DANGEROUS_PROTOCOLS = ['javascript:', 'data:', 'vbscript:'];
  for (const proto of DANGEROUS_PROTOCOLS) {
    if (normalized.startsWith(proto)) {
      return '#';
    }
  }

  const ALLOWED_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];
  // If it has a protocol, ensure it's allowed
  const protoMatch = normalized.match(/^([a-z][a-z0-9+\-.]*:)/);
  if (protoMatch) {
    if (!ALLOWED_PROTOCOLS.includes(protoMatch[1])) {
      return '#';
    }
  }

  return trimmed;
}
