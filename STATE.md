# STATE (status + decisions + changelog)

**Last updated:** 2026-10-29
**Phase:** 0 - Validation
**Implementation:** Not started
**Kill date:** 2026-11-06 (proposed - edit if you choose another, but write the new date and why)

## Objective
Find out whether WhatsApp-based sellers in ONE chosen segment have a recurring, costly problem tracking orders, deposits and unpaid balances, and whether they will commit real usage.

## Open items (must be resolved in this order)
1. **Segment + country:** NOT DECIDED. Choose one before outreach. Criteria: you can reach 20 sellers directly, you speak their language, their currency/payment habits are known to you.
2. **Competitor check:** NOT DONE. List 5 tools sellers in that segment already use (WhatsApp Business labels/catalog, notebooks, Excel, ledger apps). Write what each does badly.
3. **Real tester commitments:** 0 so far.

## Decisions
| ID | Decision | Status | Why |
|----|----------|--------|-----|
| D-001 | Validate before building | Accepted | A prior project got little interaction; test demand first |
| D-002 | Start with WhatsApp-based small sellers | Hypothesis | Specific workflow; must be narrowed to one segment |
| D-003 | Build a PWA | Accepted | One codebase, link sharing, no store publishing |
| D-004 | No AI API in MVP | Accepted | Cost and complexity |
| D-005 | Local data (IndexedDB) | Accepted, with conditions | Must ship with export/restore and persistent-storage request in the MVP (not later) |
| D-006 | Debt-first home screen ("Who owes me") | Proposed | Matches the core promise better than an order list |
| D-007 | Payments stored as a list, not one number | Proposed | Installments are common; a single field loses history |
| D-008 | Receipts shared as image/PDF via share sheet | Proposed | Sellers send images in chats; print-to-PDF is a desktop habit |
| D-009 | Fewer docs, one state file | Accepted | Docs overhead must not exceed product work |

## Changelog
- 2026-10-28: Project bootstrapped (v1 docs).
- 2026-10-29: v2 restructure: merged state/changelog/decisions, strengthened validation (commitment asks, competitor question, kill date), moved export/backup into MVP, added debt-first screen, payments list, share-target experiment, phone normalization, receipt sharing.
