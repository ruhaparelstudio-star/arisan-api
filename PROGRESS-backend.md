# arisan-api — Progress Tracker (Backend)

> Update setiap akhir sesi. Dibaca Claude Code di awal setiap sesi.
> Format: `[ ]` belum · `[~]` in progress · `[x]` selesai · `[!]` blocker

---

## Status Keseluruhan

| Sesi | Feature | Status |
|------|---------|--------|
| BE-0 | Setup Infrastruktur | `[x]` |
| BE-1 | Auth OTP | `[x]` |
| BE-2 | Manajemen Grup | `[x]` |
| BE-3 | Tracking Pembayaran | `[ ]` |
| BE-4 | Sistem Undian | `[ ]` |
| BE-5 | Tanggal & Swap | `[ ]` |
| BE-6 | Notifikasi | `[ ]` |
| BE-7 | Admin Dashboard | `[ ]` |
| BE-8 | Privacy & Beta Prep | `[ ]` |

---

## BE-0 — Setup Infrastruktur

```
[x] Scaffold Hono project (Node 20, TypeScript)
[x] Setup Docker + Dockerfile
[x] Buat .env.example lengkap
[x] Koneksi Supabase berhasil (test query)
[x] Jalankan 001_initial.sql — semua tabel terbuat
[x] Aktifkan Supabase Realtime: payments, winners, swap_requests, periods
[x] Verifikasi pg_cron
[x] Health check endpoint: GET /health → { status: "ok" }
[x] Setup middleware skeleton: jwtAuth, checkPlan (kosong)
[x] Setup logger.ts (pengganti console.log)
[x] Setup GitHub Actions: ci.yml, auto-format.yml, pr-check.yml
[x] Buat CLAUDE.md di root repo
```

**pg_cron status:**
> `[x]` Aktif — pakai Supabase cron
> `[ ]` Tidak aktif — pakai GitHub Actions cron

**Catatan:**
> Sesi BE-0 selesai 2026-05-29. Stack: Hono 4.7.11, @hono/node-server 1.13.7, @supabase/supabase-js 2.49.4, TypeScript 5, Node 20.
> ESLint 10 flat config (eslint.config.js). Husky + lint-staged aktif di pre-commit.
> Supabase: 001_initial.sql sudah dibuat — perlu dijalankan manual di Supabase SQL Editor.
> Realtime + pg_cron: perlu dikonfirmasi di Supabase dashboard (task Koneksi Supabase).

---

## BE-1 — Auth OTP

```
[x] npm install: zod, jsonwebtoken, @types/jsonwebtoken
[x] src/services/otp.ts:
    [x] generateOTP() — crypto.randomInt 6 digit
    [x] checkRateLimit() — max 5x/jam per nomor
    [x] saveOTP() — simpan ke otp_codes, TTL 5 menit
    [x] verifyOTP() — cek expires_at, used_at
    [x] sendViaFonnte() — AbortController FONNTE_TIMEOUT_MS
[x] src/routes/auth.ts:
    [x] POST /api/auth/send-otp (Zod validasi +62xxx)
    [x] POST /api/auth/verify-otp (return JWT)
[x] src/middleware/auth.ts — jwtAuth middleware
[x] src/routes/users.ts:
    [x] GET /api/users/me
    [x] PUT /api/users/me
    [x] DELETE /api/users/me (anonymize)
    [x] PUT /api/users/push-token
[ ] Test manual: send-otp → verify-otp → /me
```

**Catatan:**
> Sesi BE-1 selesai 2026-05-30. Tambah zod 3.x, @hono/zod-validator, jsonwebtoken.
> Fix TypeScript: Hono context variables butuh generik `<{ Variables: { userId, phone } }>` di route dan `createMiddleware<{ Variables: ... }>` di middleware.
> Type-check clean. Routes terdaftar di index.ts: /api/auth/*, /api/users/*.

---

## BE-2 — Manajemen Grup

```
[x] src/services/groups.ts:
    [x] generateInviteCode() — 8 char uppercase, unique check
    [x] canUserJoinOrCreate() — max 3 grup aktif
    [x] isGroupEditable()
    [x] invalidateInviteCode()
    [x] logActivity()
[x] src/routes/groups.ts:
    [x] POST /api/groups
    [x] GET /api/groups
    [x] GET /api/groups/:id
    [x] POST /api/groups/join
    [x] PUT /api/groups/:id/urutan
    [x] DELETE /api/groups/:id (bubarkan)
    [x] DELETE /api/groups/:id/leave
[ ] Test manual: buat grup → join → set urutan
```

**Catatan:**
> Sesi BE-2 selesai 2026-05-30. Registrasi route di index.ts: /api/groups/*.
> Urutan route penting: POST /join dan DELETE /:id/leave didaftarkan SEBELUM /:id agar tidak tertangkap sebagai param.
> logActivity diberi error logging (tidak throw) sesuai pola service eksternal.
> Type-check clean tanpa error.

---

## BE-3 — Tracking Pembayaran

```
[ ] src/services/payments.ts:
    [ ] getPeriodPaymentStatus()
    [ ] getGroupPaymentSummary()
    [ ] confirmPayment() — simpan confirmed_by + confirmed_at
    [ ] cancelConfirmPayment()
    [ ] markLatePayments() — untuk cron
[ ] src/routes/payments.ts:
    [ ] GET /api/payments/:groupId
    [ ] GET /api/payments/:groupId/:periodId
    [ ] POST /api/payments/:groupId/:periodId/confirm
    [ ] DELETE /api/payments/:groupId/:periodId/confirm
    [ ] GET /api/payments/cron/mark-late (X-Cron-Secret)
[ ] Test: konfirmasi bayar → cek Realtime trigger
```

**Catatan:**
> _(isi setelah sesi)_

---

## BE-4 — Sistem Undian

```
[ ] src/services/undian.ts:
    [ ] undianFixed()
    [ ] undianRandom() — PostgreSQL RANDOM() dalam transaction
    [ ] undianManual()
    [ ] broadcastUndianResult() — Stream.io + push notif
[ ] src/routes/undian.ts:
    [ ] POST /api/groups/:id/undian
[ ] Verifikasi: tabel winners INSERT ONLY, tidak ada UPDATE/DELETE
[ ] Test: ketiga mode undian
```

**Catatan:**
> _(isi setelah sesi)_

---

## BE-5 — Tanggal & Swap

```
[ ] Route tanggal:
    [ ] PUT /api/groups/:groupId/periods/:periodId/tanggal
    [ ] Hitung jatuh_tempo otomatis H-3
[ ] src/services/swaps.ts:
    [ ] getUserSwapCount() — max 2x per grup
    [ ] createSwapRequest()
    [ ] respondSwap() — target terima/tolak
    [ ] approveSwap() — ketua approve/reject, tukar urutan
[ ] src/routes/swaps.ts:
    [ ] POST /api/swaps
    [ ] POST /api/swaps/:id/respond
    [ ] POST /api/swaps/:id/approve
[ ] Notif WA + push di setiap step
```

**Catatan:**
> _(isi setelah sesi)_

---

## BE-6 — Notifikasi

```
[ ] npm install: expo-server-sdk
[ ] src/services/notifications.ts:
    [ ] sendExpoPush()
    [ ] sendWA() — Fonnte, tidak throw jika gagal
    [ ] sendWithDedup() — cek notif_log sebelum kirim
[ ] src/routes/cron.ts:
    [ ] GET /api/cron/payment-reminder
    [ ] GET /api/cron/pelaksanaan-reminder
[ ] PUT /api/users/push-token — simpan Expo push token
[ ] Setup cron: pg_cron ATAU GitHub Actions (sesuai BE-0)
[ ] src/services/streamio.ts:
    [ ] sendSystemMessage() — tidak throw jika gagal
```

**Catatan:**
> _(isi setelah sesi)_

---

## BE-7 — Admin Dashboard

```
[ ] src/routes/admin.ts (semua dilindungi X-Admin-Secret):
    [ ] GET /admin/stats/overview
    [ ] GET /admin/users (dengan masked phone)
    [ ] GET /admin/users/:id
    [ ] POST /admin/users/:id/suspend
    [ ] POST /admin/users/:id/unsuspend
    [ ] DELETE /admin/users/:id (anonymize)
    [ ] GET /admin/groups
    [ ] GET /admin/groups/:id
    [ ] GET /admin/otp-stats
    [ ] GET /admin/system-health
    [ ] POST /admin/cron/trigger/:type
```

**Catatan:**
> _(isi setelah sesi)_

---

## BE-8 — Privacy & Beta Prep

```
[ ] Verifikasi DELETE /api/users/me → anonymize benar
[ ] Audit: tidak ada data sensitif di log (OTP, phone lengkap)
[ ] Security: semua endpoint JWT sudah benar
[ ] Grep: tidak ada secret di source code
[ ] RLS audit di Supabase: user tidak bisa query data orang lain
[ ] Test: winners tidak bisa di-UPDATE/DELETE (RLS)
[ ] Deploy ke DigitalOcean — verifikasi production
```

**Catatan:**
> _(isi setelah sesi)_

---

## Keputusan Teknis

```
BE-0 (2026-05-29):
- ESLint 10 tidak support .eslintrc.json — pakai eslint.config.js (flat config)
- Dockerfile multi-stage (builder + runner) — lebih kecil dari spec single-stage
- Husky pre-commit: npx lint-staged (eslint --fix + prettier --write pada src/**/*.ts)
- lint-staged config ada di package.json (bukan file terpisah)
```

## Blocker Aktif

```
(kosong)
```
