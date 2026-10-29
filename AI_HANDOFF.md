# AI Handoff

## Read first
`README.md`, `STATE.md`, `VALIDATION_PLAN.md`, then `MVP_SPEC.md` if the Go gate is met.

## Current status
Validation. Do not assume demand is proven. Do not write app code until `STATE.md` records GO.

## What to help with now
- Segment selection and the competitor check
- Outreach messages and interview scripts in the seller's language
- Synthesizing interview logs; flagging weak signals (compliments without commitments)
- A clickable mockup spec

## Coding contract (after GO)
For every code change provide:
1. Exact file path
2. Exact start/end boundaries or insertion point
3. Complete replacement code
4. Commands/steps to verify
5. Expected result and likely troubleshooting

Do not silently overwrite files or expand the MVP. Do not invent credentials, endpoints, or test results.

## Constraints
- One-week MVP after GO; zero-cost tools; no paid APIs
- No cloud sync, auth, automatic WhatsApp sending, or payments in v1
- Export/restore and persistent storage are IN the MVP
- Be explicit about local-storage limits

## After each milestone
Update `STATE.md` only (status, decisions, changelog), and tick `ROADMAP.md`.
