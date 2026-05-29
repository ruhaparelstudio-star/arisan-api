# arisan-api — CLAUDE.md

> Letakkan file ini di root `arisan-api/CLAUDE.md`.
> Dibaca otomatis oleh Claude Code di setiap sesi backend.
> Update section "Catatan Sesi" setelah setiap sesi selesai.

---

## Stack

- **Runtime:** Node.js 20, TypeScript
- **Framework:** Hono.js (`@hono/node-server`)
- **Database:** Supabase PostgreSQL — client di `src/db/supabase.ts`
- **Auth:** JWT — middleware di `src/middleware/auth.ts`
- **Chat:** Stream.io — JANGAN replace tanpa diskusi
- **Notifikasi WA:** Fonnte — timeout MAX `FONNTE_TIMEOUT_MS` ms
- **Push:** Expo Push (`expo-server-sdk`)
- **Deploy:** DigitalOcean via Docker
- **Dev:** WSL2, Docker Compose bersama arisan-admin

---

## Struktur File

```
src/
├── index.ts
├── routes/
│   ├── health.ts
│   ├── auth.ts           ← /api/auth/*
│   ├── users.ts          ← /api/users/*
│   ├── groups.ts         ← /api/groups/*
│   ├── payments.ts       ← /api/payments/*
│   ├── undian.ts         ← /api/groups/:id/undian
│   ├── swaps.ts          ← /api/swaps/*
│   ├── cron.ts           ← /api/cron/* → X-Cron-Secret
│   └── admin.ts          ← /admin/* → X-Admin-Secret
├── middleware/
│   ├── auth.ts           ← jwtAuth
│   └── checkPlan.ts      ← skeleton, kosong di Phase Awal
├── services/
│   ├── otp.ts
│   ├── groups.ts
│   ├── payments.ts
│   ├── undian.ts
│   ├── swaps.ts
│   ├── streamio.ts
│   └── notifications.ts
├── db/
│   └── supabase.ts
└── utils/
    └── logger.ts         ← WAJIB pakai ini, bukan console.log
supabase/
└── migrations/
    └── 001_initial.sql   ← jangan ubah, buat file baru jika perlu
```

---

## Environment Variables

Semua di `.env` — lihat `.env.example`. JANGAN hardcode.

```
SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY
FONNTE_TOKEN, FONNTE_TIMEOUT_MS=3000
STREAM_API_KEY, STREAM_API_SECRET
JWT_SECRET, ADMIN_SECRET_KEY, CRON_SECRET
PORT=3001, NODE_ENV=development
```

---

## Rules Wajib

**Code:**
- Pakai `logger.ts` — tidak ada `console.log` di production code
- Tidak ada hardcode secret — selalu `process.env.VAR`
- Tidak ada dependency baru tanpa konfirmasi
- Tidak ada perubahan schema — buat migration file baru
- Semua input divalidasi dengan **Zod**
- Semua `/api/*` kecuali `/api/auth/*` wajib `jwtAuth`

**Keamanan:**
- `winners`: INSERT ONLY — tidak ada UPDATE/DELETE endpoint
- `activity_log`: INSERT ONLY — tidak ada UPDATE/DELETE endpoint
- `/api/cron/*`: dilindungi `X-Cron-Secret`
- `/admin/*`: dilindungi `X-Admin-Secret`

**Error response format:**
```json
{ "error": "pesan dalam Bahasa Indonesia" }
```
HTTP codes: 400 validasi · 401 auth · 403 akses · 404 tidak ada · 429 rate limit · 503 service eksternal

**Service eksternal (Fonnte, Stream.io):**
Jika gagal → `logger.error`, jangan throw, jangan gagalkan transaksi utama.

---

## Business Rules

- Max 3 grup aktif per user
- Invite code: 8 karakter uppercase, unique, expired saat grup penuh atau periode pertama mulai
- Grup tidak bisa diedit setelah periode pertama `active`
- Swap: max 2x per user per grup, hanya periode belum berlangsung
- Notif dedup: unique `(user_id, type, sent_date)` di `notif_log`
- Undian random: pakai PostgreSQL `RANDOM()` dalam transaction — bukan `Math.random()`

---

## GitHub Actions Workflows

| File | Trigger | Fungsi |
|------|---------|--------|
| `ci.yml` | Push semua branch, PR ke main/develop | Lint, format check, type-check |
| `auto-format.yml` | Push ke branch selain main | Auto-format + commit |
| `pr-check.yml` | PR ke main | Lint, type-check, cek console.log |
| `migrate.yml` | Push ke main (path: `supabase/migrations/**`), manual | `supabase link` + `supabase db push` |

**Secrets yang dibutuhkan di GitHub:**
- `SUPABASE_ACCESS_TOKEN` — dari supabase.com/dashboard/account/tokens
- `SUPABASE_PROJECT_REF` — ID project (contoh: `vqjfvbvmavwqapsznycp`)
- `SUPABASE_DB_PASSWORD` — dari Project Settings → Database

**Catatan penting:**
- `supabase/setup-cli@v1` masih Node.js 20 (dari pihak Supabase) — tunggu v2
- `actions/checkout` dan `actions/setup-node` sudah di v5 (Node.js 24)
- Migration baru: cukup buat file `supabase/migrations/00X_nama.sql`, push ke main → otomatis jalan
- ESLint memakai flat config (`eslint.config.js`) — bukan `.eslintrc.json` (ESLint 10+)
- Husky skip di Docker/production via `NODE_ENV !== production` check di `prepare` script

---

## Referensi

- Schema: `supabase/migrations/001_initial.sql`
- Progress: `PROGRESS-backend.md`
- Dev guide: `../DEVELOPMENT_GUIDE.md`

---

## Jika Ragu

STOP dan tanya. Jangan assume. Jangan karang implementasi.

---

## Catatan Sesi

> Claude mengisi bagian ini setelah setiap sesi dengan keputusan teknis, workaround, dan hal penting.

```
BE-0 (2026-05-29): Stack selesai, health endpoint aktif.

BE-1 (2026-05-30):
- Hono context variables membutuhkan generik eksplisit: `new Hono<{ Variables: { userId: string; phone: string } }>()` di routes dan `createMiddleware<{ Variables: ... }>` di middleware — tanpa ini TypeScript error "Argument not assignable to type 'never'".
- @hono/zod-validator otomatis return 400 + pesan error Zod jika validasi gagal.
```
