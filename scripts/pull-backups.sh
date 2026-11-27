#!/usr/bin/env bash
#
# SellFlow — pull the host's backups onto this machine.
#
#   SSH_TARGET=deploy@staging.sellflow.shop ./scripts/pull-backups.sh ~/sellflow-backups
#
# Runs on the laptop, never on the server: the point of the copy is that the
# host cannot delete it. Additive by construction —
#
#   * no --delete, so a file that has disappeared on the host (pruned by the
#     14-day retention, or the host itself is gone) stays here;
#   * --append-verify, so a partial transfer is completed and then checked
#     rather than overwritten from scratch;
#   * the directory is 0700 and every file 0600, because a backup holds every
#     account row.
#
# Environment:
#   SSH_TARGET           user@host (required)
#   REMOTE_BACKUP_DIR    directory on the host, default /srv/sellflow/backups
#   RSYNC_SSH            transport for rsync, default `ssh` (tests replace it)

set -Eeuo pipefail

SSH_TARGET="${SSH_TARGET:-}"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_DIR:-/srv/sellflow/backups}"
RSYNC_SSH="${RSYNC_SSH:-ssh}"
DEST="${1:-}"

die() { printf 'fail %s\n' "$*" >&2; exit 1; }

[ -n "$SSH_TARGET" ] || die "SSH_TARGET is not set (export SSH_TARGET=user@host)"
[ -n "$DEST" ] || die "usage: SSH_TARGET=user@host $0 <local-directory>"
command -v rsync >/dev/null 2>&1 || die "rsync is not installed"

umask 077
mkdir -p "$DEST"
chmod 700 "$DEST"

printf 'Pulling %s:%s -> %s\n' "$SSH_TARGET" "$REMOTE_BACKUP_DIR" "$DEST"

# -i prints one line per transferred file; -a keeps timestamps so a re-run can
# tell what it already has. No --delete anywhere in this file, by intent.
rsync \
  --archive \
  --itemize-changes \
  --append-verify \
  --chmod=F600,D700 \
  --exclude='*-wal' \
  --exclude='*-shm' \
  -e "$RSYNC_SSH" \
  "$SSH_TARGET:$REMOTE_BACKUP_DIR/" "$DEST/"

chmod 700 "$DEST"
# --chmod applies to files rsync creates; an older copy pulled before that flag
# existed would keep its wider mode, so tighten every backup file as well.
find "$DEST" -maxdepth 1 -type f -name 'sellflow-*.db' -exec chmod 600 {} +

count="$(find "$DEST" -maxdepth 1 -type f -name 'sellflow-*.db' | wc -l | tr -d ' ')"
# `ls -t` rather than `find -printf`: BSD find (macOS) has no -printf.
newest="$(ls -1t "$DEST"/sellflow-*.db 2>/dev/null | head -1 || true)"

printf 'Local backups: %s file(s)\n' "$count"
[ -n "$newest" ] && printf 'Newest: %s\n' "$newest"
printf 'Nothing was deleted. Verify the newest copy with:\n  node scripts/verify-backup.mjs %s\n' "${newest:-<file>}"