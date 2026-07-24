#!/bin/bash
# HSMC Database Migration Script
set -e
DB="${1:-hsmc.db}"
echo "Migrating $DB..."
sqlite3 "$DB" < "$(dirname "$0")/schema.sql"
echo "Schema done."
sqlite3 "$DB" < "$(dirname "$0")/seed.sql"
echo "Seed done."
TABLES=$(sqlite3 "$DB" '.tables' | wc -w)
echo "Migration complete. Tables: $TABLES"
