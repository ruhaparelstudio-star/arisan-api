#!/usr/bin/env bash
# Generate Supabase TypeScript types dari production schema
# Cara 1: isi SUPABASE_ACCESS_TOKEN di .env lalu jalankan `npm run gen:types`
# Cara 2: SUPABASE_ACCESS_TOKEN=sbp_xxx npm run gen:types
# Token: https://supabase.com/dashboard/account/tokens

set -e

# Load .env jika token belum di-set
if [ -z "$SUPABASE_ACCESS_TOKEN" ] && [ -f ".env" ]; then
  export $(grep -E "^SUPABASE_ACCESS_TOKEN=" .env | xargs) 2>/dev/null || true
fi

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "❌ SUPABASE_ACCESS_TOKEN tidak di-set."
  echo "   Isi di .env: SUPABASE_ACCESS_TOKEN=sbp_xxxxxx"
  echo "   Token: https://supabase.com/dashboard/account/tokens"
  exit 1
fi

PROJECT_ID="vqjfvbvmavwqapsznycp"
OUT="src/db/database.types.ts"

echo "⏳ Generating types dari project ${PROJECT_ID}..."
npx supabase gen types typescript \
  --project-id "$PROJECT_ID" \
  --schema public \
  > "$OUT"

echo "✅ Types ditulis ke $OUT"
echo ""
echo "Langkah berikutnya — aktifkan typed client di src/db/supabase.ts:"
echo "  1. Uncomment: import type { Database } from './database.types';"
echo "  2. Ganti: createClient(url, key, ...) → createClient<Database>(url, key, ...)"
