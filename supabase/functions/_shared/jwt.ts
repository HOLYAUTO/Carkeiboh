/**
 * ストアの API を呼ぶための署名付きトークン（JWT）と、JWS の中身の読み出し。
 * App Store Server API は ES256（.p8 の秘密鍵）、Google の OAuth はサービスアカウントの RS256。
 */

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const encoder = new TextEncoder();

function encodeJson(value: unknown): string {
  return base64UrlEncode(encoder.encode(JSON.stringify(value)));
}

/**
 * JWS（header.payload.signature）の payload を読む。署名は確かめない。
 * ストアの API から TLS で受け取った値か、受け取った後に API で照合し直す値にだけ使うこと
 */
export function decodeJwsPayload<T>(jws: string): T {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('JWS の形式が正しくありません');
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))) as T;
}

/** PEM（-----BEGIN PRIVATE KEY-----）から PKCS#8 の中身を取り出す。環境変数で改行が \n になっていても読む */
function pemToPkcs8(pem: string): ArrayBuffer {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  // 標準の base64 も base64UrlDecode で読める
  return base64UrlDecode(body).buffer as ArrayBuffer;
}

async function sign(header: Record<string, unknown>, payload: Record<string, unknown>, key: CryptoKey, algorithm: AlgorithmIdentifier | EcdsaParams) {
  const input = `${encodeJson(header)}.${encodeJson(payload)}`;
  const signature = new Uint8Array(await crypto.subtle.sign(algorithm, key, encoder.encode(input)));
  return `${input}.${base64UrlEncode(signature)}`;
}

/** ES256。Web Crypto の ECDSA の署名は r||s の形なので、そのまま JWS に使える */
export async function signEs256(header: Record<string, unknown>, payload: Record<string, unknown>, privateKeyPem: string) {
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(privateKeyPem), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return sign({ ...header, alg: 'ES256', typ: 'JWT' }, payload, key, { name: 'ECDSA', hash: 'SHA-256' });
}

export async function signRs256(header: Record<string, unknown>, payload: Record<string, unknown>, privateKeyPem: string) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return sign({ ...header, alg: 'RS256', typ: 'JWT' }, payload, key, { name: 'RSASSA-PKCS1-v1_5' });
}
