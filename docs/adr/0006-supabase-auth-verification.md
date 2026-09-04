# ADR-0006: Supabase JWT Verification via Shared Secret

**Status**: Accepted

**Date**: 2026-09-04

## Context

BrowserBound requires player authentication: users sign up with email/password, receive a JWT from Supabase, and must present that token to join the game server. The server needs to verify the token is genuine before trusting the user identity embedded in it.

Three approaches exist for JWT verification:

1. **Local verification via shared secret**: The server and Supabase share a secret (the JWT signing key). The server uses that secret to verify the signature locally. Fast, offline, but requires the secret to be hardcoded in the server (rotation is manual). Suitable for projects where the server and auth provider are under the same organizational control.

2. **Proxying through Supabase's servers**: The server sends the token to Supabase's `/auth/verify` endpoint to validate it. Supabase returns the decoded token if valid. Requires an HTTP call per join; slow and online-dependent, but the verification is delegated to the source of truth.

3. **Using Colyseus's built-in `@colyseus/auth` module**: Colyseus provides authentication integration; the server registers an auth callback and Colyseus handles token validation. Delegates to a pluggable strategy (local verification, proxying, etc.) but adds a dependency.

Current implementation uses **local verification** via `jose.jwtVerify()`, manually verifying the token with `SUPABASE_JWT_SECRET` in the `GameRoom.onAuth()` method.

## Decision

Verify Supabase JWTs locally using the shared JWT secret (`SUPABASE_JWT_SECRET`) and the `jose` library.

### Implementation

```typescript
import { jwtVerify } from 'jose';

export class GameRoom extends Room {
  static async onAuth(token: string): Promise<{userId: string}> {
    const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
    const verified = await jwtVerify(token, secret);
    return {userId: verified.payload.sub as string};
  }
}
```

The token is passed as the room's `auth` option when joining/creating:
```typescript
// Client
const room = await client.create('game', {auth: token});
```

Failed verification raises an exception; Colyseus rejects the room join with a 401.

## Rationale

1. **Performance**: No I/O on every join. Local verification completes in microseconds.

2. **Offline capability**: The server doesn't need to reach Supabase to verify a token. During Supabase outages, the game continues (though new signups will fail).

3. **Simplicity**: `jose` is a lightweight library that handles HMAC-SHA256 (the Supabase default) without dependencies. No middleware or callback registration required.

4. **Aligned ownership**: In a solo or small-team project, the server and auth provider are operationally aligned. Sharing the signing key is acceptable.

5. **No vendor lock-in**: If Supabase is ever replaced, the server can be updated to verify against a different provider's key—the structure doesn't change.

## Consequences

**Benefits**:
- Fast, stateless verification
- Works offline
- Simple integration
- Verifies signature authenticity (tamper detection)

**Costs**:
- **Secret rotation is manual**: If the JWT signing key is rotated on Supabase, the server's `SUPABASE_JWT_SECRET` must be updated by hand. There is no mechanism to pull the new key automatically.
- **Single secret shared between client and server**: The anon key and JWT secret are the same in Supabase's architecture. If the secret is compromised, authentication is compromised.
- **No revocation on the server side**: A token that is valid at check-time will pass, even if Supabase has revoked it in the interim. Checking revocation requires proxying or polling Supabase.
- **Token claims are not double-checked**: `jose.jwtVerify()` verifies the signature and expiration, but does not check whether the user exists or is still active in Supabase. A deleted user's token will still validate.

**Mitigations**:
- Secret rotation should be infrequent and planned (not forced by Supabase). Update the server `.env` file and restart.
- Token expiration is checked (default 1 hour for Supabase), so a revoked token will fail once it expires.
- The game room can additionally call Supabase's admin API to fetch the user's profile on first join, catching deleted users at that point.

## Alternatives Considered

**Proxying through Supabase**:
```typescript
const response = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
  headers: {Authorization: `Bearer ${token}`}
});
```
Pros: No shared secret; revocation is checked; token claims are fresh. Cons: Network I/O on every join (100ms+); requires Supabase to be online; rate-limited.

**Colyseus Auth Module**:
```typescript
import { Auth } from '@colyseus/auth';
const auth = new Auth().setPassword(...);  // or other providers
```
Pros: Pluggable strategy; could swap verification backends. Cons: Adds a dependency; Colyseus's module is not widely used and less well-documented than `jose`.

We chose local verification for its performance and simplicity. Revocation checking (via a call to Supabase's admin API on join) can be added later if needed.

## Open Questions

- Should the server reject tokens older than N days to force periodic re-authentication? Currently, tokens are valid until expiration.
- Should the server maintain a blocklist of revoked tokens? This would require external state (database) and periodic Supabase polling.
