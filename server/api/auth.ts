import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface SessionAuthOptions {
  /** The shared access code people type once to use the app. */
  code: string;
  /** HMAC key for session tokens. Defaults to a random key, so sessions end when the server restarts. */
  secret?: string;
  now?: () => number; // epoch ms
  ttlMs?: number;
}

const DAY_MS = 86_400_000;
export const SESSION_COOKIE = 'webfly_session';

/** Access-code login with stateless, signed, expiring session tokens. */
export class SessionAuth {
  readonly ttlMs: number;
  private readonly codeDigest: Buffer;
  private readonly secret: string;
  private readonly now: () => number;

  constructor(opts: SessionAuthOptions) {
    this.codeDigest = createHash('sha256').update(opts.code).digest();
    this.secret = opts.secret ?? randomBytes(32).toString('hex');
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? 30 * DAY_MS;
  }

  /** Constant-time comparison (digests have equal length, so no length leak). */
  checkCode(input: unknown): boolean {
    if (typeof input !== 'string') return false;
    return timingSafeEqual(createHash('sha256').update(input.trim()).digest(), this.codeDigest);
  }

  issue(): string {
    const exp = String(this.now() + this.ttlMs);
    return `${exp}.${this.sign(exp)}`;
  }

  verify(token: string | undefined): boolean {
    if (!token) return false;
    const dot = token.indexOf('.');
    if (dot < 1) return false;
    const exp = token.slice(0, dot);
    const sig = Buffer.from(token.slice(dot + 1));
    const want = Buffer.from(this.sign(exp));
    if (sig.length !== want.length || !timingSafeEqual(sig, want)) return false;
    return Number(exp) > this.now();
  }

  private sign(exp: string): string {
    return createHmac('sha256', this.secret).update(exp).digest('base64url');
  }
}

/**
 * Same-origin check from the headers browsers attach. Blocks other websites from using the API from a
 * browser; requests with neither header (curl, scripts) pass here and are stopped by the session check.
 */
export function isSameOrigin(headers: { secFetchSite?: string; origin?: string; host?: string }): boolean {
  const { secFetchSite, origin, host } = headers;
  if (secFetchSite !== undefined) return secFetchSite === 'same-origin' || secFetchSite === 'none';
  if (origin !== undefined) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return true;
}
