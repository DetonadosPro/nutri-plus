#!/usr/bin/env sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL não configurada" >&2
  exit 1
fi

backup_dir="${NUTRI_BACKUP_DIR:-/var/backups/nutriplus}"
retention_days="${NUTRI_BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$backup_dir/nutriplus-$timestamp.dump"

mkdir -p "$backup_dir"
umask 077
pg_dump --format=custom --no-owner --no-acl --file="$backup_file" "$DATABASE_URL"
pg_restore --list "$backup_file" >/dev/null

if [ -n "${NUTRI_BACKUP_S3_URI:-}" ]; then
  aws s3 cp "$backup_file" "${NUTRI_BACKUP_S3_URI%/}/$(basename "$backup_file")" --only-show-errors
fi

find "$backup_dir" -type f -name 'nutriplus-*.dump' -mtime "+$retention_days" -delete
echo "$backup_file"
