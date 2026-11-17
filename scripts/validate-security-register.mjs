#!/usr/bin/env node
/**
 * Security-register consistency validator.
 *
 * Part 1 (2026-11-17) added this check because `STATE.md` previously used
 * mismatched titles for the canonical audit IDs and listed S-12 as both open and
 * accepted. The audit report is the source of record; this script makes the
 * register mechanically checkable without adding a dependency.
 *
 * Checks:
 *   1. `STATE.md` contains exactly one register row per canonical ID, S-01..S-15.
 *   2. No duplicate IDs.
 *   3. Every title matches the canonical audit title.
 *   4. Every status is from the approved vocabulary.
 *   5. The set of "Accepted" rows equals the set of rows in the acceptance
 *      evidence table, and neither table repeats an ID.
 *   6. The "Pending owner acceptance" table matches its expected set and no
 *      pending finding is also marked Accepted.
 *   7. The audit report still contains a heading for every canonical ID.
 *
 * 2026-11-17 closeout: S-14 was removed from the accepted set. Its acceptance
 * rested only on an agent-authored report ("Buffy (automated acceptance
 * review)") that itself says a human owner review may still be warranted, and
 * no owner acceptance decision exists in the repository. Implementation
 * authorization (D-019) and passing tests are not acceptance.
 *
 * Exit code 0 = all checks pass, 1 = at least one failure.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CANONICAL = {
  "S-01": "Dispute disclosure — any authenticated user can list every dispute",
  "S-02": "Unvalidated `customerOrderId` creates a cross-tenant order link (IDOR)",
  "S-03": "Payment-claim state can be self-assigned as CONFIRMED or DISPUTED",
  "S-04": "Supplier can jump the order lifecycle to any status",
  "S-05": "No authentication rate limiting or account lockout",
  "S-06": "Demo credentials are published and seeded with a shared password",
  "S-07": "Registration grants verification tier 1 without email verification",
  "S-08": "`ORDER_ONLY` customer-data visibility leaks customer identity",
  "S-09": "No password reset or change flow",
  "S-10": "Commercial terms are stored but not enforced",
  "S-11":
    "Stock confirmation does not validate or decrement stock; cancellation does not restore it",
  "S-12": "Audit trail is empty in the audited database and writes are best-effort",
  "S-13": "No explicit CSRF token",
  "S-14": "Long-lived sessions without rotation",
  "S-15": "Demo seed creates a platform admin and mediator",
};

const STATUSES = new Set([
  "Open",
  "Authorized",
  "Implemented — awaiting verification",
  "Verification in progress",
  "Accepted",
  "Deferred",
  "Explicitly excluded",
]);

const EXPECTED_ACCEPTED = ["S-01", "S-02", "S-12"];

/**
 * Findings whose evidence exists but whose acceptance is not recorded.
 * A finding listed here must not also be Accepted.
 */
const EXPECTED_PENDING = ["S-14"];

const failures = [];
const passes = [];
const fail = (m) => failures.push(m);
const pass = (m) => passes.push(m);

/** Split a markdown table row into trimmed cells, ignoring the outer pipes. */
function cells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return null;
  const end = text.indexOf(endMarker, start + startMarker.length);
  return text.slice(start, end === -1 ? undefined : end);
}

const state = readFileSync(resolve(root, "STATE.md"), "utf8");
const audit = readFileSync(resolve(root, "SELLFLOW_V02_AUDIT_REPORT.md"), "utf8");

// ── 1-4: register table ────────────────────────────────────────────────────
const registerSection = section(
  state,
  "### Security register",
  "### Acceptance evidence",
);
if (!registerSection) {
  fail("STATE.md: '### Security register' section not found");
} else {
  const rows = registerSection
    .split("\n")
    .filter((l) => /^\|\s*S-\d\d\s*\|/.test(l))
    .map(cells);

  if (rows.length !== 15) {
    fail(`register has ${rows.length} finding rows; expected 15`);
  } else {
    pass("register contains 15 finding rows");
  }

  const seen = new Map();
  for (const row of rows) {
    const [id, title, status] = row;
    if (seen.has(id)) fail(`duplicate register ID ${id}`);
    seen.set(id, { title, status });
  }
  if (seen.size === rows.length) pass("no duplicate register IDs");

  for (const id of Object.keys(CANONICAL)) {
    if (!seen.has(id)) {
      fail(`missing canonical ID ${id}`);
      continue;
    }
    const { title, status } = seen.get(id);
    if (title !== CANONICAL[id]) {
      fail(`${id} title mismatch\n     expected: ${CANONICAL[id]}\n     actual:   ${title}`);
    }
    if (!STATUSES.has(status)) {
      fail(`${id} has unapproved status "${status}"`);
    }
  }
  if (!failures.some((f) => f.startsWith("missing canonical ID") || f.includes("title mismatch"))) {
    pass("all 15 canonical IDs present with matching titles");
  }
  if (!failures.some((f) => f.includes("unapproved status"))) {
    pass("all statuses use the approved vocabulary");
  }

  // ── 5: accepted set agreement ────────────────────────────────────────────
  const acceptedInRegister = [...seen.entries()]
    .filter(([, v]) => v.status === "Accepted")
    .map(([id]) => id)
    .sort();

  const acceptanceSection = section(
    state,
    "### Acceptance evidence",
    "### Pending owner acceptance",
  );
  if (!acceptanceSection) {
    fail("STATE.md: acceptance evidence section not found");
  } else {
    const evidenceRows = acceptanceSection
      .split("\n")
      .filter((l) => /^\|\s*S-\d\d\s*\|/.test(l))
      .map(cells);
    const evidenceIds = evidenceRows.map((r) => r[0]);
    const dupes = evidenceIds.filter((id, i) => evidenceIds.indexOf(id) !== i);
    if (dupes.length) fail(`acceptance evidence repeats IDs: ${dupes.join(", ")}`);

    const expected = [...EXPECTED_ACCEPTED].sort();
    if (JSON.stringify(acceptedInRegister) !== JSON.stringify(expected)) {
      fail(
        `register Accepted set ${JSON.stringify(acceptedInRegister)} != expected ${JSON.stringify(expected)}`,
      );
    } else {
      pass(`register Accepted set matches expected ${expected.join(", ")}`);
    }
    if (JSON.stringify([...evidenceIds].sort()) !== JSON.stringify(expected)) {
      fail(
        `acceptance evidence IDs ${JSON.stringify([...evidenceIds].sort())} != expected ${JSON.stringify(expected)}`,
      );
    } else {
      pass("acceptance evidence IDs match the accepted set");
    }
  }

  // ── 6: pending owner acceptance ───────────────────────────────────────────
  const pendingSection = section(
    state,
    "### Pending owner acceptance",
    "### Acceptance provenance caveats",
  );
  if (!pendingSection) {
    fail("STATE.md: '### Pending owner acceptance' section not found");
  } else {
    const pendingIds = pendingSection
      .split("\n")
      .filter((l) => /^\|\s*S-\d\d\s*\|/.test(l))
      .map((l) => cells(l)[0]);
    if (JSON.stringify([...pendingIds].sort()) !== JSON.stringify([...EXPECTED_PENDING].sort())) {
      fail(
        `pending-acceptance IDs ${JSON.stringify([...pendingIds].sort())} != expected ${JSON.stringify(EXPECTED_PENDING)}`,
      );
    } else {
      pass(`pending-acceptance IDs match expected ${EXPECTED_PENDING.join(", ")}`);
    }
    const alsoAccepted = pendingIds.filter((id) => seen.get(id)?.status === "Accepted");
    if (alsoAccepted.length) {
      fail(`pending findings also marked Accepted: ${alsoAccepted.join(", ")}`);
    } else {
      pass("no pending finding is simultaneously marked Accepted");
    }
  }
}

// ── 6: audit report still defines every canonical ID ───────────────────────
const missingHeadings = Object.keys(CANONICAL).filter(
  (id) => !new RegExp(`^### ${id} —`, "m").test(audit),
);
if (missingHeadings.length) {
  fail(`audit report is missing headings for: ${missingHeadings.join(", ")}`);
} else {
  pass("audit report defines all 15 canonical findings");
}

for (const p of passes) console.log(`PASS  ${p}`);
for (const f of failures) console.error(`FAIL  ${f}`);
console.log(
  `\n${passes.length} passed, ${failures.length} failed — security register ${
    failures.length ? "INCONSISTENT" : "consistent"
  }`,
);

process.exit(failures.length ? 1 : 0);
