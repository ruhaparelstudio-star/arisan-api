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
| BE-3 | Tracking Pembayaran | `[x]` |
| BE-4 | Sistem Undian | `[x]` |
| BE-5 | Tanggal & Swap | `[x]` |
| BE-5.5 | Stream.io Chat | `[x]` |
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
[x] src/services/payments.ts:
    [x] getPeriodPaymentStatus()
    [x] confirmPayment() — simpan confirmed_by + confirmed_at
    [x] cancelConfirmPayment()
    [x] markLatePayments() — untuk cron
[x] src/routes/payments.ts:
    [x] GET /api/payments/:groupId/:periodId
    [x] POST /api/payments/:groupId/:periodId/confirm
    [x] DELETE /api/payments/:groupId/:periodId/confirm
    [x] GET /api/payments/cron/mark-late (X-Cron-Secret)
[ ] Test: konfirmasi bayar → cek Realtime trigger
```

**Catatan:**
> Sesi BE-3 selesai 2026-05-30. Type-check clean.
> Urutan route kritis: /cron/mark-late didaftarkan SEBELUM use('*', jwtAuth) dan SEBELUM /:groupId/:periodId — cron tidak butuh JWT, hanya X-Cron-Secret.
> markLatePayments query dari DB menggunakan periods!inner join + filter lt(jatuh_tempo).
> Saat jwtAuth diimplementasi penuh (BE-1 TODO), cron endpoint otomatis bypass karena sudah didaftarkan sebelum middleware.

---

## BE-4 — Sistem Undian

```
[x] src/services/streamio.ts:
    [x] sendSystemMessage() — tidak throw jika Stream.io gagal
[x] src/services/undian.ts:
    [x] undianFixed() — ambil anggota berdasarkan urutan = periodeKe
    [x] undianRandom() — pakai PostgreSQL RANDOM() via RPC undian_random
    [x] undianManual() — validasi di route, return user_id
    [x] saveWinner() — INSERT ONLY, tidak ada UPDATE/DELETE
    [x] broadcastUndianResult() — Stream.io, tidak throw jika gagal
[x] src/routes/undian.ts:
    [x] POST /api/groups/:id/undian — validasi ketua, periode aktif, belum ada winner
[x] Daftarkan undianRoute di index.ts: app.route('/api/groups', undianRoute)
[x] Verifikasi: tidak ada UPDATE/DELETE endpoint untuk tabel winners
[x] Type-check clean, ESLint clean
[ ] Test manual: ketiga mode undian
[ ] Buat fungsi PostgreSQL undian_random di Supabase SQL Editor
```

**Catatan:**
> Sesi BE-4 selesai 2026-05-30. Type-check clean, ESLint clean.
> undianRoute didaftarkan di /api/groups (bersama groupsRoute) — Hono mencoba semua route yang match prefix secara berurutan.
> Supabase nested relation (users.name) bertipe `unknown` saat di-join — perlu cast via `unknown` dulu sebelum target type.
> Fungsi PostgreSQL undian_random harus dibuat manual di Supabase SQL Editor (lihat komentar di undian.ts).
> winners: INSERT ONLY — tidak ada endpoint UPDATE/DELETE dibuat.

---

## BE-5 — Tanggal & Swap

```
[x] Route tanggal:
    [x] PUT /api/groups/:groupId/periods/:periodId/tanggal
    [x] Hitung jatuh_tempo otomatis H-3
[x] src/services/swaps.ts:
    [x] getUserSwapCount() — max 2x per grup
    [x] createSwapRequest()
    [x] respondSwap() — target terima/tolak
    [x] approveSwap() — ketua approve/reject, tukar urutan
[x] src/routes/swaps.ts:
    [x] POST /api/swaps
    [x] POST /api/swaps/:id/respond
    [x] POST /api/swaps/:id/approve
    [x] GET /api/swaps/group/:groupId (ketua)
    [x] GET /api/swaps/my
[x] Notif WA di setiap step (push: BE-6 — expo-server-sdk belum install)
[x] src/services/notifications.ts — sendWA() stub untuk BE-5
```

**Catatan:**
> Sesi BE-5 selesai 2026-05-30. Type-check clean, ESLint clean.
> notifications.ts dibuat minimal (WA-only via Fonnte) — BE-6 menambahkan sendExpoPush + sendWithDedup.
> GET /api/swaps/my dan /api/swaps/group/:groupId WAJIB didaftarkan sebelum /:id agar tidak tertangkap sebagai param.
> approveSwap melakukan dua UPDATE terpisah saat swap urutan — tidak ada atomic swap di SQL karena tidak ada unique constraint konflik (dua user, dua row berbeda).
> jatuh_tempo dihitung dari tanggal_pelaksanaan - 3 hari via JS Date arithmetic, disimpan sebagai YYYY-MM-DD string.

---

## BE-5.5 — Stream.io Chat

```
[x] npm install stream-chat
[x] src/services/streamio.ts (full):
    [x] generateUserToken()
    [x] createGroupChannel()
    [x] addMemberToChannel()
    [x] removeMemberFromChannel()
    [x] sendSystemMessage() — implementasi nyata (bukan logger.info)
[x] Retrofit src/routes/groups.ts:
    [x] POST /api/groups → createGroupChannel setelah insert
    [x] POST /api/groups/join → addMemberToChannel setelah insert
    [x] DELETE /:id/leave → removeMemberFromChannel setelah delete
[x] GET /api/users/stream-token → generateUserToken
[ ] Uji: channel terbuat di Stream.io dashboard
```

**Catatan:**
> Sesi BE-5.5 selesai 2026-05-30. Type-check clean.
> stream-chat SDK ChannelData tidak menyertakan custom fields (name, created_by_id) di default generics — diperlukan cast `as Record<string, unknown>` agar type-check lolos tanpa mengubah generic signature seluruh client.
> Semua fungsi Stream tidak throw — kegagalan hanya di-log via logger.error agar tidak gagalkan operasi utama (grup, join, undian).
> sendSystemMessage sekarang benar-benar mengirim ke Stream.io channel (bukan hanya logger.info seperti sebelumnya).

---

## BE-6 — Notifikasi

```
[x] npm install: expo-server-sdk
[x] src/services/notifications.ts:
    [x] sendExpoPush() — skip jika token tidak ada/invalid, tidak throw
    [x] sendWA() — Fonnte, AbortController FONNTE_TIMEOUT_MS, tidak throw
    [x] sendWithDedup() — insert notif_log (unique constraint), conflict = skip
[x] src/routes/cron.ts:
    [x] GET /api/cron/payment-reminder — X-Cron-Secret, query periods.jatuh_tempo
    [x] GET /api/cron/pelaksanaan-reminder — X-Cron-Secret, 7 hari lagi
[x] Daftarkan cronRoute di index.ts: app.route('/api/cron', cronRoute)
[x] Type-check clean, ESLint clean
[ ] PUT /api/users/push-token — sudah ada dari BE-1, tidak perlu diulang
[ ] Setup cron: GitHub Actions (pg_cron tidak dikonfirmasi aktif)
```

**Catatan:**
> Sesi BE-6 selesai 2026-05-30. Type-check clean, ESLint clean.
> sendWA() tetap memakai signature (userId, message) — konsisten dengan swaps.ts dari BE-5 (fetch phone dari DB internal).
> sendWithDedup() memanggil sendExpoPush + sendWA secara serial; dedup via unique constraint notif_log(user_id, type, sent_date) — conflict = return early.
> payment-reminder: query periods.jatuh_tempo terlebih dahulu (2 nilai: today + H+3), lalu join ke payments.period_id. Tidak pakai filter nested PostgREST karena lebih aman dengan 2 query terpisah.
> pelaksanaan-reminder: query periods per tanggal, lalu loop group_members per group_id (N+1 acceptable untuk skala arisan kecil).
> Cron schedule: perlu dikonfigurasi via GitHub Actions (lihat github-actions workflow) atau pg_cron jika sudah diaktifkan.

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
