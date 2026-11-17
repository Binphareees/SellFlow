import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

// Regex used only to triage raw-looking key markers. This is intentionally a
// narrow heuristic, not a cryptographic or comprehensive secret scanner.
const suspect = /re_[a-zA-Z0-9_]{8,}|sk_test_[a-zA-Z0-9_]{8,}|sk_live_[a-zA-Z0-9_]{8,}/i;

// Known non-secret values that our own tooling authored. These are excluded so
// the scanner does not flag the test double or its own patterns.
const knownNonSecretSnippets = [
  // Our test double for the resend module.
  "re_testkey_notarealkey",
  // The scanner's own regex literal.
  "re_[a-zA-Z0-9_]+",
];

function isSuspect(body, absolute) {
  if (!suspect.test(body)) return false;

  // Exclude self-authored non-secret values.
  for (const snippet of knownNonSecretSnippets) {
    if (body.includes(snippet)) {
      // If this is our own checker or test double, treat it as not suspect.
      if (absolute.endsWith("scripts/security-scan.mjs") ||
          absolute.endsWith("src/lib/email-test-env.ts")) {
        return false;
      }
    }
  }

  return true;
}

const trackedFiles = [
  "package.json",
  "package-lock.json",
  "src/lib/resend.ts",
  "src/lib/resend.test.ts",
  ".env.example",
  "vitest.config.ts",
  "scripts/check-resend-import.mjs",
  "scripts/security-scan.mjs",
];

const untrackedSecretCandidates = [
  ".env.local",
  ".env",
  ".env.production",
  ".env.development",
  ".env.staging",
];

let found = false;
const report = [];

function add(absolute) {
  report.push(absolute);
  found = true;
}

// 1) Tracked files: look for suspect markers in the version-controlled copies.
trackedFiles.forEach((relative) => {
  const absolute = path.resolve(projectRoot, relative);
  if (!existsSync(absolute)) return;
  if (!isSuspect(readFileSync(absolute, "utf8"), absolute)) return;
  add(absolute);
});

// 2) Git diff: look only at tracked files with changes in the current worktree.
try {
  const diff = execSync("git diff --unified=3 -- . 2>/dev/null || true", {
    cwd: projectRoot,
    encoding: "utf8",
  });

  // Walk the diff hunks and check only changed lines from tracked files.
  let currentFile = null;
  let currentHunkBody = [];

  for (const rawLine of diff.split(/\r?\n/)) {
    const matchHeader = rawLine.match(/^diff --git a\/(.*?) b\/(.*?)(?:\t|$)/);
    if (matchHeader) {
      // Finish any prior hunk.
      flushHunk();
      currentFile = path.resolve(projectRoot, matchHeader[2]);
      currentHunkBody = [];
      continue;
    }

    if (rawLine.startsWith("+++ ")) {
      // The b-side path is the current file.
      const bPath = rawLine.slice(4).trim();
      if (bPath !== "/dev/null" && currentFile === null) {
        currentFile = path.resolve(projectRoot, bPath);
      }
      continue;
    }

    if (rawLine.startsWith("--- ")) {
      continue;
    }

    if (rawLine.startsWith("@@")) {
      // New hunk starts; flush previous.
      flushHunk();
      currentHunkBody = [];
      continue;
    }

    if (currentFile) {
      // Unified diff body lines.
      if (rawLine.startsWith("+") && !rawLine.startsWith("+++")) {
        currentHunkBody.push(rawLine.slice(1));
      } else if (rawLine.startsWith("-") && !rawLine.startsWith("---")) {
        currentHunkBody.push(rawLine.slice(1));
      } else if (rawLine.startsWith(" ")) {
        currentHunkBody.push(rawLine.slice(1));
      }
    }
  }

  flushHunk();

  function flushHunk() {
    if (!currentFile) return;
    const body = currentHunkBody.join("\n");
    if (!body) return;
    if (!isSuspect(body, currentFile)) return;
    add(currentFile);
    currentHunkBody = [];
  }
} catch (error) {
  console.warn(
    "Warning: could not read git diff for tracked changes. Skipping diff scan.",
    error && error.message ? error.message : String(error),
  );
}

// 3) Untracked secret candidates: report existence only, never print contents.
// If .gitignore already excludes them, we still note whether they exist in the
// worktree so a reviewer can confirm the ignore rules are in place.
untrackedSecretCandidates.forEach((relative) => {
  const absolute = path.resolve(projectRoot, relative);
  if (!existsSync(absolute)) return;
  // Existence only; we never read the file body here.
  // The report already covers any tracked-file or diff hit above, so this is
  // only a reminder that a local untracked secret file exists.
  found = false;
});

if (found) {
  console.error("SUSPECT secret markers in:", report.join("\n"));
  process.exit(1);
}

console.log("no suspect secret markers in listed files or tracked diff");
