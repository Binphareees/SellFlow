# S-09 / S-14 Database Migration Status Report

**Objective:** Read-only determination of whether the modified `20261105060000_session_lifecycle` migration was applied to `prisma/dev.db` and whether its stored checksum matches the current file.

**Restrictions followed:** Read-only only. No migration, build, seed, server, or integration-test commands were run. No project or migration files were edited, restored, deleted, moved, or created except this required report. No secrets, environment values, or credentials were read or printed.

---

## 1. Method

- Database opened with Python `sqlite3` using a read-only URI:
  - `file:/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/dev.db?mode=ro`
  - `uri=True`
  - `PRAGMA query_only=ON`
- Schema discovery: `PRAGMA table_info('_prisma_migrations');`
- Rows retrieved using the actual discovered columns.
- Schema inspected with:
  - `SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name;`
- Checksums:
  - migration file SHA-256 computed from disk
  - dev database SHA-256 computed from disk
- No write operations were performed.

---

## 2. Discovered `_prisma_migrations` schema

From read-only `PRAGMA table_info('_prisma_migrations')`:

- `id` — `TEXT`, NOT NULL, PK
- `checksum` — `TEXT`, NOT NULL
- `finished_at` — `DATETIME`
- `migration_name` — `TEXT`, NOT NULL
- `logs` — `TEXT`
- `rolled_back_at` — `DATETIME`
- `started_at` — `DATETIME`, NOT NULL, default `current_timestamp`
- `applied_steps_count` — `INTEGER UNSIGNED`, NOT NULL, default `0`

Note: this schema does **not** contain a separate `started_at` vs `finished_at` mismatch issue; both are present. It also does not include a column named `origin`.

---

## 3. `_prisma_migrations` rows

All rows were retrieved, ordered by `id DESC`.

### 3.1 Row for `20261105060000_session_lifecycle`

- **id:** `d68a8367-3aa8-4f77-8be7-641acc17a096`
- **migration_name:** `20261105060000_session_lifecycle`
- **checksum:** `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
- **started_at:** `1794224544273`
- **finished_at:** `1794224544289`
- **applied_steps_count:** `1`
- **rolled_back_at:** `null`
- **logs:** `null`

### 3.2 Other migration rows present

- `20261102203150_init`
- `20261102213950_dispute_claim_link`
- `20261102222213_subscriptions`
- `20261104060000_login_throttle`
- `20261105000000_stock_integrity`
- `20261105060000_session_lifecycle`

That is six rows total, matching the six migration directories present in `prisma/migrations/`.

---

## 4. Checksum comparison

### 4.1 Stored checksum

For migration `20261105060000_session_lifecycle`:

- stored checksum: `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`

### 4.2 Current file checksum

For file:

- `/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/migrations/20261105060000_session_lifecycle/migration.sql`

computed SHA-256: `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40`

### 4.3 Comparison result

- stored checksum: `539bd5b6...`
- current file checksum: `33b41fc7...`
- **match:** **no**
- **discrepancy:** **yes**

The stored checksum does **not** match the SHA-256 of the current modified migration file.

---

## 5. Database schema findings

### 5.1 `PasswordResetToken`

From `sqlite_master`:

- table exists
- SQL:
  - `CREATE TABLE "PasswordResetToken" (`
  - `"id" TEXT NOT NULL PRIMARY KEY,`
  - `"userId" TEXT NOT NULL,`
  - `"hashedToken" TEXT NOT NULL,`
  - `"used" BOOLEAN NOT NULL DEFAULT false,`
  - `"expiresAt" DATETIME NOT NULL,`
  - `"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,`
  - `CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE`
  - `)`

Indexes present for `PasswordResetToken` (from `sqlite_master` where `type='index'`):

- `PasswordResetToken_userId_idx`
- `PasswordResetToken_expiresAt_idx`
- `PasswordResetToken_hashedToken_unique`

There is also a system-generated unique internal index:
- `sqlite_autoindex_PasswordResetToken_1`

So:

- **PasswordResetToken exists in the database:** **yes**
- **Indexes match the S-09 Prisma model expectation:** **yes**
  - userId index
  - expiresAt index
  - unique hashedToken index

---

### 5.2 Session-related schema objects relevant to S-14

Relevant objects present:

- table `Session`
- index `Session_userId_lastUsedAt_idx`
- index `Session_userId_idx`
- index `Session_expiresAt_idx`
- index `Session_tokenHash_key`
- internal autoindex `sqlite_autoindex_Session_1`

From `sqlite_master`, the `Session` table SQL includes:
- `"lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`

So:

- **Session.lastUsedAt exists in the database:** **yes**
- **S-14 session index exists in the database:** **yes**

---

## 6. Questions answered

### 6.1 Does the S-14 migration have a row in `_prisma_migrations`?

**Yes.**

- migration_name: `20261105060000_session_lifecycle`
- id: `d68a8367-3aa8-4f77-8be7-641acc17a096`

### 6.2 Did it complete successfully?

**Evidently yes, as recorded.**

- `finished_at` is set to a non-null value
- `applied_steps_count` is `1`
- `logs` is `null`

This indicates a recorded completed migration step.

### 6.3 Was it rolled back?

**No evidence of rollback.**

- `rolled_back_at` is `null`

### 6.4 Stored checksum

**Yes, available.**

- `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`

### 6.5 Current file SHA-256

**Yes.**

- `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40`

### 6.6 Do the checksums match?

**No.**

- stored checksum != current file checksum

---

## 7. Does the database evidence support the conclusion that the modified migration was applied?

**Partially, but with a critical caveat.**

Direct database evidence shows:

- A migration record for `20261105060000_session_lifecycle` exists.
- The record shows completion (`finished_at` set, `applied_steps_count=1`, no rollback).
- `PasswordResetToken` and its indexes exist.
- `Session.lastUsedAt` and `Session_userId_lastUsedAt_idx` exist.

That is consistent with **some** version of the S-14 migration having been applied in the past.

However, the database evidence also shows:

- the **stored checksum** for that migration is `539bd5b6...`
- the **current file checksum** is `33b41fc7...`
- those checksums **do not match**

Therefore:

- The database does **not** establish that the **current modified file** was the version applied.
- The database establishes only that **a migration named `20261105060000_session_lifecycle` was applied**, with the checksum recorded at apply time.

A checksum mismatch does **not** by itself reveal the exact historical file contents. It only establishes that the current file differs from the file whose checksum was recorded when the migration was applied.

---

## 8. Remaining uncertainty

### 8.1 Exact historical migration file contents

Unknown.

- The stored checksum is the only disk-based evidence we have about the applied file.
- No committed, backed-up, or otherwise verified copy of the original S-14 migration was found in this repository or workspace.
- The current file differs from that stored checksum.

### 8.2 Whether `prisma migrate status` reflects an exact historical match

`prisma migrate status` reported `Database schema is up to date!`.

That is consistent with the database schema matching the current migration tree as evaluated by Prisma, but it does **not** by itself prove that the current on-disk migration file was the exact file originally applied.

### 8.3 Meaning of the stored checksum

The stored checksum represents the migration artifact as recorded by Prisma when the migration was applied. It is evidence that the applied version was **not identical** to the current modified file. It is **not** a standalone proof of the exact prior file text without an original copy to compare against.

---

## 9. Conclusion

1. **S-14 migration row exists:** yes
2. **Completed successfully (as recorded):** yes
3. **Rolled back:** no evidence of rollback
4. **Stored checksum:** `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
5. **Current file SHA-256:** `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40`
6. **Checksums match:** no
7. **PasswordResetToken exists in database:** yes
8. **Database evidence supports that the modified migration text was applied:** no, not as the exact applied file; it supports that a migration with that name was applied, but the recorded checksum differs from the current file
9. **Remaining uncertainty:** exact historical contents of the applied migration file are not independently verifiable here

**Final labels:**

- DATABASE APPLICATION STATUS CONFIRMED — **not** used
- DATABASE APPLICATION STATUS UNRESOLVED — **used**, because the exact applied file contents are not verifiable here

**Most accurate summary:**

The database shows that a migration named `20261105060000_session_lifecycle` was applied and completed, and that the S-14 and S-09 schema objects are present. It also shows a checksum mismatch between the recorded migration checksum and the current modified migration file, so the current file cannot be treated as the verified originally applied artifact.
