# Tech Stack and Platform Risks

> **SUPERSEDED — historical document (2026-11-04).** This file describes the original Vite + IndexedDB + static-host plan. The actual stack is Next.js 15 App Router + Prisma 6 + SQLite with first-party sessions, deployed as a Node server. Retained for history; see `README.md` and `STATE.md` D-011 for the current architecture.

## MVP
- React + Vite, plain CSS or Tailwind
- `vite-plugin-pwa` (manifest, service worker, offline cache)
- IndexedDB via a small wrapper (e.g. `idb`); not localStorage, because order/payment records are structured
- Web Share API (receipts), Web Share Target (experiment)
- GitHub + Cloudflare Pages or another free static host (verify current limits and terms)

## Platform risks to verify on real devices
- **Storage eviction:** browsers can clear site data under storage pressure or inactivity. [Likely] Safari on iPhone is stricter for sites that are not installed. Mitigation: request persistent storage, encourage install, ship backup/restore.
- **Web Share Target** works in installed PWAs on supported Android browsers; confirm WhatsApp can share into it.
- **Web Share with files** support varies; keep a download/print fallback.
- **`wa.me` links** require digits-only international numbers.
- **Service worker updates:** test that a new deploy actually reaches installed users (avoid stuck old versions).

## Cost guardrails
- No AI API in the MVP; no domain purchase until there is demand evidence.
- Store only necessary data; no secrets in the repo.
- Later backend (e.g. Supabase) only if sellers demonstrate they need sync; check quotas, inactivity rules and pricing first.

## Deployment checklist
- [ ] Repo created
- [ ] Build succeeds; production preview checked
- [ ] HTTPS deploy works on Android
- [ ] Manifest and icons validated; install tested
- [ ] Offline behavior tested
- [ ] Export/restore tested end to end
- [ ] Update flow tested (deploy v2, installed v1 updates)
- [ ] Privacy and data-limit notice visible in app
