# Security policy

narrativepad is in **preview**. The live site runs on a simulated chain, and the escrow program is **unaudited and not deployed to mainnet**. Even so, we treat security reports as the highest priority.

## Reporting a vulnerability

Please report privately through GitHub: **[Report a vulnerability](https://github.com/narrativepad/narrativepad/security/advisories/new)** (Security tab → Advisories).

Include what you found, how to reproduce it, and the impact you expect. Please don't open a public issue, post on social media, or test against other people's funds or accounts.

## What's in scope

- The escrow program (`programs/narrative_escrow`): any way funds can move other than a depositor's refund, the launch, or a depositor's claim; any way to block refunds; signer, PDA and account-validation bugs; rounding that leaks value.
- The web app and API (`apps/web`): signature or nonce bypass, vote manipulation, moderation bypass, XSS, data exposure.
- Anything that would let someone launch a coin with metadata other than the locked metadata.

## Our commitments

- We'll acknowledge your report within 72 hours.
- We'll keep you informed while we fix it, and credit you when it's published, if you'd like.
- Before any mainnet launch, the repository will include a full `SECURITY.md` listing every privileged action and every way funds can move, and the program will have an external audit.
