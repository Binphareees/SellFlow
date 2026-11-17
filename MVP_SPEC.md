# MVP Specification (build only after GO)

> **SUPERSEDED — historical document (2026-11-04).** This spec describes the original local-first, IndexedDB-only MVP. The actual implementation is a server-rendered Next.js 15 + Prisma + SQLite application with accounts, a marketplace, private reseller pricing, supplier orders and disputes. Retained for history; do not use as current build instructions. See `PRD_V0.2.md`, `README.md`, and `STATE.md` D-011.

## User story
As a small seller who takes orders on WhatsApp, I want to log orders fast, see exactly who owes me, and send a clear reminder or receipt in one tap, so I stop losing money in scattered chats and notes.

## Screens
1. **Home: "Who owes me"** - customers with balance > 0, sorted by amount or age, total outstanding, one-tap "Remind" (opens WhatsApp with prefilled text).
2. **Orders** - list with filters by payment state (unpaid / partial / paid) and status.
3. **Add/Edit order** - fast form (target: under 15 seconds for a simple order).
4. **Order detail** - payments history, add payment, status, share receipt.
5. **Settings** - business name, currency, default country code, language, export/restore, storage notice.

## Data model
Customer: id, name, phone (optional, stored normalized), createdAt
Order: id, customerId, description, totalAmount, currency, status (pending | processing | ready | delivered | cancelled), notes (optional), createdAt, updatedAt, deletedAt (soft delete)
Payment: id, orderId, amount, paidAt, note (optional)
Derived: amountPaid = sum(payments); balanceDue = totalAmount - amountPaid

Money rule: store amounts as integers in the smallest unit (e.g. cents/kobo) to avoid floating-point errors.

## Core behaviors
- Payments are a list; adding an installment never overwrites history.
- Overpayment is blocked with a clear message (credit/refunds are out of scope).
- Deleting an order is a soft delete with "Undo" for 10 seconds and a Trash view.
- Phone normalization: user sets default country code; numbers are converted to digits-only international format (no `+`, no leading zero) for `https://wa.me/<number>?text=<encoded message>`. Bad numbers show an error, not a dead link.
- WhatsApp handoff opens a draft; it never sends automatically.
- Receipt: generated as an image or PDF and shared through the Web Share API where supported; fallback to download/print.
- **Export/Restore (MVP, not later):** one-tap JSON backup (shareable to WhatsApp/Files) and CSV for orders; restore from JSON with a preview and confirmation. Show a backup reminder after every 10 new orders or 7 days.
- Request persistent storage (`navigator.storage.persist()`) and show whether it was granted.
- Clear notice: data lives only on this device/browser; clearing site data or changing phones can erase it; use Backup.

## Experiment (time-boxed, 1 day max)
**Share-to-SellFlow:** register a Web Share Target so a seller can share a WhatsApp message into the installed PWA and prefill an order (customer text into notes/description). Verify on a real Android phone; if unreliable, drop it. A simple "Paste message" field is the fallback. No AI, no automatic parsing beyond simple number detection.

## Acceptance criteria
- Required fields validated; no negative amounts.
- Balance always equals total minus sum of payments.
- Create, edit, soft-delete/undo, filter all work.
- Home screen totals match the order list.
- Export then restore on a clean browser reproduces all data.
- Works at 360px width; offline load after first visit.
- WhatsApp link tested on Android with and without WhatsApp installed, and with local-format phone numbers.
- Receipt share tested on a real phone.
- No real customer data in screenshots or public demos.

## Non-goals (v1)
AI features, accounts, cloud sync, automatic messages, payment gateway, multi-user, inventory, analytics beyond basic totals.

## Test checklist
Zero/partial/full payment; multiple installments; edit/delete/undo; long names and descriptions; currency formatting; phone formats; clear-site-data then restore; install and offline on a real phone; receipt sharing.
