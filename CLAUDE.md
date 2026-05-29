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

## Workflow Wajib — Setiap Sesi BE-X

### Awal Sesi — Buat Branch dari develop

```bash
git checkout develop
git pull origin develop
git checkout -b feature/be-X-<nama>
# contoh: feature/be-4-undian
```

### Selama Sesi — Commit Per Milestone

```bash
# Stage file yang relevan (jangan pakai git add -A)
git add src/routes/<feature>.ts src/services/<feature>.ts src/index.ts CLAUDE.md PROGRESS-backend.md

# Commit dengan format konvensional
git commit -m "feat(be): <deskripsi singkat>"
```

Format commit message: `feat(be): <feature> <ringkasan>`
Contoh: `feat(be): sistem undian fixed + random + manual`

Jangan commit: file `.env`, file spec `BE-*.md`, `node_modules/`, `dist/`.

### Akhir Sesi — Merge ke develop & Hapus Branch

```bash
git checkout develop
git merge feature/be-X-<nama> --no-ff
git push origin develop
git branch -D feature/be-X-<nama>
git push origin --delete feature/be-X-<nama>
```

**Aturan branch:**
- Satu branch per sesi BE-X
- Branch selalu dibuat dari `develop`, bukan dari branch lain
- Branch dihapus (lokal + remote) setelah merge ke `develop`
- Tidak ada branch feature yang hidup lebih dari satu sesi

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

BE-2 (2026-05-30):
- Urutan route registration kritis: POST /join dan DELETE /:id/leave WAJIB didaftarkan sebelum GET/DELETE /:id — Hono mencocokkan dari atas ke bawah, literal path menang atas param hanya jika dideklarasikan lebih dulu.
- logActivity tidak boleh throw — dibungkus error log saja agar tidak menggagalkan transaksi utama.

BE-3 (2026-05-30):
- Cron endpoint /cron/mark-late WAJIB didaftarkan sebelum paymentsRoute.use('*', jwtAuth) dan sebelum /:groupId/:periodId — dua alasan: (1) agar tidak tertangkap sebagai param "cron"/"mark-late", (2) agar tidak membutuhkan JWT saat jwtAuth diimplementasi penuh.
- markLatePayments menggunakan periods!inner join di Supabase query untuk filter jatuh_tempo tanpa N+1 query.

BE-4 (2026-05-30):
- undianRoute didaftarkan dua kali di /api/groups (bersama groupsRoute) — Hono match keduanya secara berurutan, tidak ada konflik karena path pattern berbeda.
- Supabase nested relation (`users(name)`) tidak bisa langsung di-cast ke `{ name: string }` — perlu `as unknown as ...` karena Supabase menginfer tipe sebagai array.
- Fungsi PostgreSQL undian_random HARUS dibuat manual di Supabase SQL Editor sebelum mode random bisa dipakai (lihat komentar di services/undian.ts).
- winners table: INSERT ONLY — tidak ada UPDATE/DELETE endpoint dibuat di seluruh BE-4.
- broadcastUndianResult dan sendSystemMessage tidak pernah throw — error hanya di-log agar kegagalan Stream.io tidak menggagalkan undian.

BE-5 (2026-05-30):
- notifications.ts dibuat minimal dengan sendWA() saja — BE-6 akan menambahkan sendExpoPush() dan sendWithDedup().
- GET routes di swapsRoute (/my dan /group/:groupId) WAJIB didaftarkan sebelum /:id route agar tidak tertangkap sebagai param.
- approveSwap melakukan dua UPDATE terpisah untuk tukar urutan — tidak ada unique constraint yang konflik karena dua user adalah dua row terpisah di group_members.
- jatuh_tempo = tanggal_pelaksanaan - 3 hari dihitung via JS Date arithmetic (toISOString().split('T')[0]) agar format YYYY-MM-DD konsisten.
- Validasi "giliran belum berlangsung" mengecek apakah ada period dengan periode_ke = member.urutan dan status = 'completed' — jika ada, swap ditolak.

BE-5.5 (2026-05-30):
- stream-chat SDK ChannelData tidak menyertakan custom fields (name, created_by_id) di default generics — diperlukan cast `as Record<string, unknown>` agar type-check lolos tanpa mengubah generic signature seluruh client.
- Semua fungsi Stream tidak throw — kegagalan hanya di-log via logger.error.
- sendSystemMessage sekarang benar-benar mengirim ke channel (bukan stub logger.info).

BE-6 (2026-05-30):
- sendWA() tetap memakai signature (userId, message) — fetch phone dari DB internal agar swaps.ts tidak perlu tahu nomor HP.
- sendWithDedup() dedup via INSERT ke notif_log dengan UNIQUE(user_id, type, sent_date) — conflict error = skip (tidak throw).
- expo-server-sdk: parameter `data` di sendPushNotificationsAsync harus bertipe `Record<string, unknown>`, bukan `object`.
- payment-reminder cron: 2 query terpisah (periods → payments) lebih aman daripada nested PostgREST filter pada kolom join.
- GitHub Actions cron (bukan pg_cron) yang dikonfirmasi untuk trigger endpoint ini.

BE-7 (2026-05-30):
- maskPhone(phone) helper: `+62 8xx-xxxx-${phone.slice(-4)}` — diterapkan konsisten di semua response admin yang menyertakan nomor HP.
- DELETE /admin/users/:id = anonymize (bukan hard delete): name=null, phone=+62DELETED+8-char-id, deleted_at=now — konsisten dengan DELETE /api/users/me dari BE-1.
- system-health Supabase: try rpc('health_check_select1') → fallback ke count query tabel users. Jika kedua gagal → supabase: 'error'.
- system-health Stream: queryChannels({}, {}, { limit: 1 }) di try/catch — kegagalan = stream: 'error', tidak throw.
- cron/trigger/:type: internal fetch ke localhost endpoint dengan X-Cron-Secret — tidak ada duplikasi logik cron.
- Supabase nested join (users di group_members) bertipe unknown di SDK — perlu cast `as unknown as` sebelum target interface.
```
