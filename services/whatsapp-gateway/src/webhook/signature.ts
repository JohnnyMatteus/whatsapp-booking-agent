// Validação do X-Hub-Signature-256: HMAC-SHA256 do corpo BRUTO com o App Secret.
// O corpo precisa ser o buffer exato recebido; re-serializar o JSON muda os bytes.
import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = 'sha256=';

export function signBody(body: Buffer, appSecret: string): string {
  return PREFIX + createHmac('sha256', appSecret).update(body).digest('hex');
}

export function isValidSignature(body: Buffer, header: string | undefined, appSecret: string): boolean {
  if (header === undefined || !header.startsWith(PREFIX)) return false;
  const received = Buffer.from(header.slice(PREFIX.length), 'hex');
  const expected = createHmac('sha256', appSecret).update(body).digest();
  // Comparação em tempo constante; tamanhos diferentes já são inválidos.
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Token do handshake GET; também comparado em tempo constante. */
export function isValidVerifyToken(received: string | undefined, expected: string): boolean {
  if (received === undefined) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
