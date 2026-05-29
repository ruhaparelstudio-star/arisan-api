# arisan-api — Progress Tracker (Backend)

> Update setiap akhir sesi. Dibaca Claude Code di awal setiap sesi.
> Format: `[ ]` belum · `[~]` in progress · `[x]` selesai · `[!]` blocker

---

## Status Keseluruhan

| Sesi | Feature | Status |
|------|---------|--------|
| BE-0 | Setup Infrastruktur | `[x]` |
| BE-1 | Auth OTP | `[ ]` |
| BE-2 | Manajemen Grup | `[ ]` |
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
[ ] npm install: zod, jsonwebtoken, @types/jsonwebtoken
[ ] src/services/otp.ts:
    [ ] generateOTP() — crypto.randomInt 6 digit
    [ ] checkRateLimit() — max 5x/jam per nomor
    [ ] saveOTP() — simpan ke otp_codes, TTL 5 menit
    [ ] verifyOTP() — cek expires_at, used_at
    [ ] sendViaFonnte() — AbortController FONNTE_TIMEOUT_MS
[ ] src/routes/auth.ts:
    [ ] POST /api/auth/send-otp (Zod validasi +62xxx)
    [ ] POST /api/auth/verify-otp (return JWT)
[ ] src/middleware/auth.ts — jwtAuth middleware
[ ] src/routes/users.ts:
    [ ] GET /api/users/me
    [ ] PUT /api/users/me
    [ ] DELETE /api/users/me (anonymize)
[ ] Test manual: send-otp → verify-otp → /me
```

**Catatan:**
> _(isi setelah sesi)_

---

## BE-2 — Manajemen Grup

```
[ ] src/services/groups.ts:
    [ ] generateInviteCode() — 8 char uppercase, unique check
    [ ] canUserJoinOrCreate() — max 3 grup aktif
    [ ] isGroupEditable()
    [ ] invalidateInviteCode()
    [ ] logActivity()
[ ] src/routes/groups.ts:
    [ ] POST /api/groups
    [ ] GET /api/groups
    [ ] GET /api/groups/:id
    [ ] POST /api/groups/join
    [ ] POST /api/groups/:id/invite-code
    [ ] PUT /api/groups/:id/urutan
    [ ] DELETE /api/groups/:id (bubarkan)
    [ ] DELETE /api/groups/:id/leave
[ ] Test manual: buat grup → join → set urutan
```

**Catatan:**
> _(isi setelah sesi)_

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
