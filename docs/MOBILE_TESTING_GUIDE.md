# Mobile Testing Guide — arisan-api × Claude Code

Panduan ini untuk QA / developer mobile yang ingin menguji integrasi aplikasi mobile  
dengan arisan-api menggunakan **Claude Code** sebagai test runner.

**Base URL Production:** `https://arisan-api.vercel.app`  
**Claude Code CLI:** `claude` (install: `npm install -g @anthropic-ai/claude-code`)

---

## Setup

### 1. Buka Claude Code di direktori mobile

```bash
cd /path/to/arisan-mobile
claude
```

### 2. Beri context ke Claude

Paste perintah ini di awal sesi Claude Code:

```
Kamu akan membantu testing end-to-end arisan-api.
Base URL: https://arisan-api.vercel.app
Kita akan test dengan 2 nomor HP nyata.
User 1: +62895334719484
User 2: +6285692873673
Saya akan memberikan OTP saat kamu meminta.
```

---

## Skenario 1 — Happy Path Full Flow

Perintahkan Claude Code:

```
Lakukan E2E test lengkap arisan-api dengan flow:
1. Kirim OTP ke User 1 dan User 2 bersamaan
2. Minta OTP dari saya, lalu verify kedua user
3. Bersihkan database (pakai Supabase service key jika ada)
4. User 1 buat grup dengan 2 periode, mode random, nominal 200000
5. User 2 preview grup via invite code
6. User 2 join grup
7. User 1 (ketua) start grup
8. Ketua konfirmasi payment User 1 dan User 2
9. Ketua jalankan undian periode 1
10. Cek notifikasi kedua user — pastikan tidak ada nomor HP bocor
11. Ketua tutup periode 1, buka periode 2
12. Ulangi payment + undian untuk periode 2
13. Tutup periode 2 → grup completed
14. Cek stats akhir kedua user
Laporkan PASS/FAIL setiap langkah.
```

---

## Skenario 2 — Security Test

```
Test keamanan arisan-api:
1. Coba akses /api/groups tanpa JWT → harus 401
2. Coba akses /api/groups dengan JWT palsu → harus 401
3. Coba akses /admin/system-health tanpa secret → harus 401
4. Coba /api/cron/payment-reminder tanpa secret → harus 401
5. Coba verify OTP dengan nomor sandbox +6285600001001 kode 123456 → harus GAGAL (bypass dihapus)
6. Coba buat grup sebelum set nama profil → harus error
7. Coba User 2 konfirmasi payment (bukan ketua) → harus 403
8. Coba User 2 jalankan undian (bukan ketua) → harus 403
Laporkan hasil setiap test.
```

---

## Skenario 3 — Validasi Input

```
Test validasi input arisan-api:
1. Kirim OTP ke nomor format salah "08123456789" → harus error format readable (bukan ZodError object)
2. Buat grup dengan nominal 100 (< 10000) → harus error string readable
3. Buat grup dengan nama 1 huruf → harus error string readable
4. Kirim pesan chat kosong "" → harus error
5. Kirim pesan chat >500 karakter → harus error
6. PUT /api/users/me dengan nama 1 huruf → harus error
Pastikan TIDAK ADA "ZodError" atau "success: false" di semua response error.
```

---

## Skenario 4 — Privasi Data

```
Test privasi nomor HP di arisan-api:
Login dengan [TOKEN_USER_1].
1. GET /api/groups/:groupId — cek response, pastikan tidak ada field "phone" di members
2. GET /api/payments/:groupId/:periodId — cek response, pastikan tidak ada phone di users
3. GET /api/swaps/my — cek response, pastikan tidak ada phone di requester/target
4. POST /api/groups/:groupId/messages — cek response message.user, pastikan tidak ada phone
5. GET /api/notifications — cek body notifikasi, pastikan pemenang ditampilkan dengan nama bukan nomor HP
Laporkan jika ada "phone" atau "+62" ditemukan di response mana pun.
```

---

## Skenario 5 — Swap Flow Lengkap

```
Test tukar giliran (swap) arisan-api:
Setup: buat grup 3 periode dengan User 1 (ketua, urutan 1), User 2 (urutan 2), dan minimal 1 user lagi.
Note: untuk test ini butuh 3 user, pakai user test jika ada.

Flow yang ditest:
1. User 2 request swap dengan User 1 → harus ERROR (User 1 adalah ketua dan urutan berbeda)
2. User 2 request swap dengan User 3 (urutan 3) → berhasil (status: pending)
3. User 3 accept swap → status: waiting_ketua
4. Ketua approve swap → status: approved, urutan berubah
5. User 2 coba request swap lagi (sudah 1x) → masih bisa (max 2x)
6. Cek GET /api/swaps/my untuk User 2 → ada 1 swap approved

Edge cases:
- User 2 request swap ke user yang sudah menang undian → harus error
- User request swap ke diri sendiri → harus error
```

---

## Skenario 6 — Notifikasi & Real-time

```
Test notifikasi arisan-api:
Login dengan Token User 1 dan Token User 2.

1. Konfirmasi payment User 2 → cek notif User 2 dapat 1 payment_confirmed
2. Konfirmasi lagi (duplikat) → cek notif User 2 TIDAK bertambah (masih 1)
3. Jalankan undian → cek notif kedua user:
   - Pemenang: dapat "Kamu Menang Undian!"
   - Non-pemenang: dapat "Undian Selesai" dengan nama pemenang (bukan nomor HP)
4. PATCH /api/notifications/read-all → cek unread_count = 0
5. GET /api/notifications?limit=5 → cek pagination has_more
6. GET /api/notifications?limit=5&before=<uuid> → cek load more bekerja

Laporkan jumlah notifikasi dan isinya setiap langkah.
```

---

## Skenario 7 — Admin Dashboard

```
Test admin endpoints arisan-api (gunakan ADMIN_SECRET dari .env):

1. GET /admin/system-health → harus { supabase: ok, api: ok, stream: ok }
2. GET /admin/stats/overview → tampilkan total users, active groups, dll
3. GET /admin/users?limit=5 → cek phone ter-mask (+62 8xx-xxxx-XXXX)
4. GET /admin/groups?status=active → cek daftar grup aktif
5. GET /admin/groups/:id → cek detail grup dengan member list
6. POST /admin/cron/trigger/payment-reminder → harus { ok: true }
7. POST /admin/cron/trigger/pelaksanaan-reminder → harus { ok: true }
8. POST /admin/cron/trigger/mark-late → harus { ok: true }
```

---

## Skenario 8 — Multi-putaran Arisan

```
Test arisan multi-putaran (edge case):
Setup: buat grup dengan jumlah_periode > jumlah anggota, mode random.
Contoh: 3 periode, 2 anggota (User 1 dan User 2).

1. Periode 1: payment + undian → salah satu menang
2. Tutup periode 1
3. Periode 2: payment + undian → satunya menang
4. Tutup periode 2
5. Periode 3: payment + undian → KEDUANYA SUDAH PERNAH MENANG
   → Harus tetap bisa undian (fallback random, bukan error)
6. Tutup periode 3 → grup completed

Verifikasi tidak ada error "Tidak ada anggota yang memenuhi syarat".
```

---

## Template Prompt Cepat

### Login dua user dan simpan token:
```
Lakukan login untuk:
- User 1: +62895334719484 (kirim OTP, minta kode dari saya)
- User 2: +6285692873673 (kirim OTP, minta kode dari saya)
Simpan kedua token untuk digunakan di test selanjutnya.
Base URL: https://arisan-api.vercel.app
```

### Cek apakah nomor HP bocor:
```
Jalankan request GET /api/groups dan GET /api/payments/:gid/:pid
menggunakan token [T1]. Cek seluruh response JSON, laporkan 
apakah ada field "phone" atau string "+62" di mana pun.
```

### Cek format error:
```
Kirim request POST /api/auth/send-otp dengan phone "08123".
Cek response: harus { "error": "..." } string biasa.
TIDAK boleh ada { "success": false, "error": { ZodError } }.
```

### Quick smoke test:
```
Lakukan smoke test arisan-api di https://arisan-api.vercel.app:
1. GET /health → harus { status: ok }
2. GET /api/groups tanpa token → harus 401 dengan error message
3. GET /admin/system-health dengan X-Admin-Secret header → harus semua ok
Laporkan hasilnya.
```

---

## Tips Penggunaan Claude Code

### Simpan variabel antar langkah
Minta Claude menyimpan GID dan PID saat digunakan:
```
Simpan group ID dan period ID yang kamu dapat untuk dipakai di langkah berikutnya.
```

### Minta laporan terstruktur
```
Setelah selesai, buat laporan dengan format:
✅ PASS / ❌ FAIL per test case
Sertakan HTTP status code yang diterima dan yang diharapkan.
```

### Debug jika ada error
```
Request [ENDPOINT] mengembalikan error yang tidak diharapkan.
Tampilkan raw response body-nya dan analisa kenapa bisa terjadi.
```

### Test dengan edge case
```
Coba semua edge case berikut dan laporkan apakah sistem menanganinya dengan baik:
- UUID tidak valid
- Field yang kosong
- Nilai di luar range (nominal negatif, periode 0)
- Request duplikat berturut-turut
```

---

## Catatan Penting

- **OTP** berlaku 5 menit — minta saat siap verify, jangan terlalu lama
- **Rate limit OTP** 5x per jam per nomor — jika kena limit, tunggu 1 jam
- **DB cleanup** sebelum test agar tidak ada data lama — minta Claude untuk bersihkan via Supabase service key
- **Sandbox phone** `+628560000100x` dengan OTP `123456` hanya aktif jika `ENABLE_TEST_BYPASS=true` di env — production sudah dimatikan
- **Token JWT** berlaku 30 hari — tidak perlu login ulang setiap test session
