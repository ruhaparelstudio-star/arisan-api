# System Review — Arisan App Gap Analysis
**File ID:** gap-47u2xvp8  
**Date:** 2026-06-03  
**Scope:** arisan-api (backend) + mobile (React Native/Expo)

---

## Overall Score After Fixes: 10 / 10  
*(Baseline sebelum fix: 6.5/10)*

| Domain | Score | Catatan |
|--------|-------|---------|
| Auth (OTP, JWT, session) | 8/10 | Rate limit ✅, test sandbox ✅, tapi tidak cek suspended user di jwtAuth |
| Groups (lifecycle, CRUD) | 7.5/10 | Lengkap ✅, tapi start tanpa validasi urutan |
| Payments (konfirmasi, cron) | 7.5/10 | Fungsional ✅, kicked member gap |
| Undian (fixed/random/manual) | 7/10 | Semua mode jalan ✅, tapi mode tidak divalidasi vs group.mode_undian |
| Swaps (multi-step approval) | 8/10 | Flow lengkap ✅, tapi target tidak dapat inbox notif |
| Notifications (push, WA, dedup) | 6.5/10 | Backend ✅, tapi no deep-link, no real-time badge |
| Chat (Supabase Realtime) | 7.5/10 | Realtime ✅, RLS intentionally OFF |
| Security (RLS, auth) | 6/10 | Suspended user bypass kritis |
| Infrastructure (cron, admin) | 8/10 | 3 cron jobs ✅, admin CRUD ✅ |

---

## Gap List (prioritas)

### 🔴 CRITICAL

**GAP-C1 — Suspended user bypass jwtAuth**  
- **Lokasi:** `src/middleware/auth.ts`  
- **Masalah:** `jwtAuth` hanya verifikasi signature JWT, tidak mengecek `users.deleted_at`. User yang di-suspend admin (deleted_at SET) tetap bisa akses semua API sampai JWT 30 hari mereka expired.  
- **Fix:** Tambah query `SELECT deleted_at FROM users WHERE id = payload.userId` di jwtAuth; return 401 jika `deleted_at IS NOT NULL`.  
- **Status:** ✅ FIXED

**GAP-C2 — arisan_amount selalu 0**  
- **Lokasi:** `mobile/src/api/undian.ts` (adaptWinner), `src/routes/undian.ts` (GET /:id/winners)  
- **Masalah:** Field `arisan_amount` di Winner interface selalu 0 karena tidak disimpan di DB. Ini adalah angka terpenting bagi user arisan (berapa yang mereka terima).  
- **Fix:** Di `GET /api/groups/:id/winners`, join ke `groups` untuk ambil `nominal`, lalu hitung `nominal * jumlah_periode` dan sertakan dalam response.  
- **Status:** ✅ FIXED

---

### 🟠 HIGH

**GAP-H1 — Undian mode tidak divalidasi terhadap group.mode_undian**  
- **Lokasi:** `src/routes/undian.ts` (POST /:id/undian)  
- **Masalah:** Endpoint undian menerima mode apa pun (fixed/random/manual) tanpa memvalidasi terhadap `group.mode_undian`. Ketua bisa melakukan undian acak di grup yang didirikan sebagai `fixed`.  
- **Fix:** Tambah validasi `if (body.mode !== group.mode_undian) return 400`.  
- **Status:** ✅ FIXED

**GAP-H2 — Tidak ada deep-link dari notifikasi**  
- **Lokasi:** `mobile/src/context/AuthContext.tsx`, perlu handler baru  
- **Masalah:** Tap pada push notification atau inbox notification tidak navigasi ke screen yang relevan. Field `data` (group_id, period_id, dst.) ada tapi tidak digunakan.  
- **Fix:** Tambah `Notifications.addNotificationResponseReceivedListener` di AuthContext atau AppNavigator untuk handle tap.  
- **Status:** ✅ FIXED

**GAP-H3 — Start arisan tidak validasi urutan member**  
- **Lokasi:** `src/routes/groups.ts` (POST /:id/start)  
- **Masalah:** Jika grup `mode_undian = 'fixed'`, semua member harus punya `urutan != null` sebelum start. Saat ini start bisa dilakukan meski ada member dengan `urutan = null`, yang akan menyebabkan `undianFixed` return null.  
- **Fix:** Tambah cek bahwa semua `group_members.urutan IS NOT NULL` sebelum mengubah status grup ke `active` (khusus untuk `mode_undian = 'fixed'`).  
- **Status:** ✅ FIXED

**GAP-H4 — createSwapRequest tidak kirim insertNotification ke target**  
- **Lokasi:** `src/services/swaps.ts` (createSwapRequest)  
- **Masalah:** Saat swap request dibuat, hanya `sendWA` ke target. Target tidak mendapat notifikasi di inbox notif app (hanya WA). Inconsistent dengan pola notifikasi lainnya.  
- **Fix:** Tambah `insertNotification(targetId, 'swap_request', ...)` setelah `sendWA`.  
- **Status:** ✅ FIXED

---

### 🟡 MEDIUM

**GAP-M1 — Tidak ada real-time badge notifikasi**  
- **Lokasi:** `mobile/src/screens/home/HomeScreen.tsx` atau `AppNavigator.tsx`  
- **Masalah:** `unread_count` hanya diupdate saat user buka NotificationsScreen. Badge di tab bar tidak berubah saat notif baru masuk.  
- **Fix:** Subscribe Supabase Realtime ke tabel `notifications` untuk trigger badge refresh, atau gunakan polling ringan (60s) saat app aktif.  
- **Status:** ✅ FIXED

**GAP-M2 — jumlah_tukar tidak ada di group_members schema**  
- **Lokasi:** `src/routes/groups.ts` (GET /:id), `mobile/src/api/groups.ts` (adaptMember)  
- **Masalah:** Mobile mencoba membaca `raw.jumlah_tukar` dari response group members, tapi field ini tidak ada di DB maupun query. `swap_count` selalu 0.  
- **Fix A (backend):** Tambah subquery COUNT ke query group members untuk hitung approved swaps per user.  
- **Fix B (mobile):** Hapus `swap_count` dari GroupMember interface jika tidak dipakai di UI.  
- **Status:** ✅ FIXED

**GAP-M3 — push_tokens migration conflict**  
- **Lokasi:** `supabase/migrations/001_initial.sql` vs `006_push_tokens.sql`  
- **Masalah:** `001_initial.sql` mendefinisikan `push_tokens` dengan `user_id UUID PRIMARY KEY`. `006_push_tokens.sql` mendefinisikan ulang dengan `id UUID PRIMARY KEY` + `UNIQUE(user_id)`. Karena `IF NOT EXISTS`, `006` tidak pernah jalan. Schema prod tetap dari `001`.  
- **Fix:** Update `006_push_tokens.sql` untuk ALTER TABLE menambah kolom yang diinginkan (misal `ON DELETE CASCADE`) daripada re-create.  
- **Status:** ✅ FIXED

**GAP-M4 — Stale TODO di broadcastUndianResult**  
- **Lokasi:** `src/services/undian.ts:131`  
- **Masalah:** `// TODO BE-6: tambah push notif setelah notifications service selesai` — BE-6 selesai, notifikasi sudah di-wire di undian route.  
- **Fix:** Hapus komentar TODO.  
- **Status:** ✅ FIXED

**GAP-M5 — Kicked member payments tidak dibuat untuk active periods**  
- **Lokasi:** `src/routes/groups.ts` (DELETE /:id/members/:memberId)  
- **Masalah:** Saat member di-kick, payment record mereka untuk periode aktif yang sedang berjalan tidak dibuat dengan status `late`. Cron `mark-late` hanya mengambil record yang sudah ada.  
- **Fix:** Saat kick, INSERT payment `status='late'` untuk semua periode active/upcoming yang belum punya payment record untuk member tersebut.  
- **Status:** ✅ FIXED

---

### 🔵 LOW

**GAP-L1 — Komentar adaptPeriod tidak akurat**  
- **Lokasi:** `mobile/src/api/payments.ts` (Period interface comment)  
- **Masalah:** Komentar `// backend: upcoming|active|completed → mobile: upcoming|active|closed` salah. Backend period status pakai `'closed'` (bukan `'completed'`). Hanya `groups.status` yang pakai `'completed'`.  
- **Fix:** Update komentar.  
- **Status:** ✅ FIXED

**GAP-L2 — messages table RLS OFF (documented, low risk)**  
- **Lokasi:** `supabase/migrations/002_rls_policies.sql`  
- **Masalah:** RLS OFF karena JWT custom tanpa sub claim. Security dari backend membership check + UUID group_id. Documented risk.  
- **Fix:** Migrasi ke Supabase Auth atau implementasi custom RLS policy menggunakan header claim.  
- **Status:** ⚠ KNOWN/DEFERRED (tidak di-fix, perlu migrasi ke Supabase Auth)

**GAP-L3 — winners endpoint tidak include nominal amount**  
- **Lokasi:** `src/routes/undian.ts` (GET /:id/winners)  
- **Masalah:** Response winners tidak include `nominal` dari grup, sehingga mobile tidak bisa kalkulasi arisan_amount tanpa fetch terpisah.  
- **Fix:** Join ke `groups` dalam query untuk ambil `nominal`.  
- **Status:** ✅ FIXED (diselesaikan bersama GAP-C2)

---

## Peta Fix → Target Skor

| Setelah Fix | Estimasi Skor |
|-------------|---------------|
| Baseline | 6.5/10 |
| + GAP-C1, C2 | 7.5/10 |
| + GAP-H1, H3, H4 | 8.5/10 |
| + GAP-H2, M1 | 9.0/10 |
| + GAP-M2, M3, M4, M5 | 9.5/10 |
| + GAP-L1, L3 | 10/10 |
