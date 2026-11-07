// One secret token per agent run. The MCP proxy presents it; HQ maps it back to who is calling.
import { randomBytes } from 'node:crypto';
import type { CallerCtx } from '../domain/company.ts';

export class TokenRegistry {
  private readonly byToken = new Map<string, CallerCtx>();

  mint(ctx: CallerCtx): string {
    const token = randomBytes(32).toString('hex');
    this.byToken.set(token, ctx);
    return token;
  }

  resolve(token: string): CallerCtx | null {
    return this.byToken.get(token) ?? null;
  }

  revoke(token: string): void {
    this.byToken.delete(token);
  }
}
