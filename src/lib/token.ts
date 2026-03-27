/**
 * HMAC-SHA256 signed tokens for auth and password reset.
 * Works natively on Cloudflare Workers via Web Crypto API.
 */

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - s.length % 4) % 4);
  return atob(padded);
}

export async function signToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const json = JSON.stringify(payload);
  const encoded = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded));
  return encoded + '.' + b64url(sig);
}

export async function verifyToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const key = await hmacKey(secret);
  const sigBytes = Uint8Array.from(b64urlDecode(sig), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(encoded));
  if (!valid) return null;
  const json = b64urlDecode(encoded);
  const payload = JSON.parse(json);
  if (payload.exp && Date.now() / 1000 > payload.exp) return null;
  return payload;
}
