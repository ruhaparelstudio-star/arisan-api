# arisan-api — API Specification

**Version:** 1.0.0  
**Base URL Production:** `https://arisan-api.vercel.app`  
**Base URL Local:** `http://localhost:3001`  
**Updated:** 2026-06-03

---

## Konvensi

### Authentication
Semua endpoint `/api/*` kecuali `/api/auth/*` membutuhkan header:
```
Authorization: Bearer <JWT_TOKEN>
```

JWT didapat dari `POST /api/auth/verify-otp`. Berlaku **30 hari**.

### Error Format
Semua error mengembalikan format konsisten:
```json
{ "error": "Pesan error dalam Bahasa Indonesia" }
```

### HTTP Status Codes
| Code | Kondisi |
|------|---------|
| `200` | OK |
| `201` | Created |
| `400` | Validasi gagal / business rule violation |
| `401` | Token tidak ada / tidak valid |
| `403` | Akses ditolak (bukan ketua, bukan anggota) |
| `404` | Resource tidak ditemukan |
| `429` | Rate limit OTP |
| `500` | Server error |
| `503` | External service (Fonnte/Stream) gagal |

---

## 1. Auth

### POST `/api/auth/send-otp`
Kirim OTP ke nomor WA. Rate limit: **5x per jam** per nomor.

**Request:**
```json
{ "phone": "+62895334719484" }
```
> Format: `+62` diikuti 9–12 digit angka

**Response 200:**
```json
{ "message": "OTP berhasil dikirim ke WhatsApp kamu" }
```

**Response 429:**
```json
{ "error": "Terlalu banyak percobaan. Coba lagi dalam 1 jam." }
```

---

### POST `/api/auth/verify-otp`
Verifikasi OTP dan dapatkan JWT. OTP berlaku **5 menit**.

**Request:**
```json
{ "phone": "+62895334719484", "code": "123456" }
```

**Response 200:**
```json
{
  "token": "eyJhbGci...",
  "user": {
    "id": "a62745a2-...",
    "phone": "+62895334719484",
    "name": "Ars Dev"
  }
}
```
> `name` bisa `null` jika user baru belum set nama

---

## 2. Users

### GET `/api/users/me`
Profil user yang sedang login.

**Response 200:**
```json
{
  "user": {
    "id": "a62745a2-...",
    "phone": "+62895334719484",
    "name": "Ars Dev",
    "created_at": "2026-06-02T09:24:39.228987+00:00"
  }
}
```

---

### PUT `/api/users/me`
Update nama profil. **Wajib diisi sebelum bisa membuat grup.**

**Request:**
```json
{ "name": "Ars Dev" }
```
> Min 2 karakter, max 100 karakter

**Response 200:**
```json
{ "message": "Profil berhasil diperbarui" }
```

---

### DELETE `/api/users/me`
Hapus akun (anonymize sesuai UU PDP). Token langsung tidak valid.

**Response 200:**
```json
{ "message": "Akun berhasil dihapus" }
```

---

### GET `/api/users/me/stats`
Statistik arisan user.

**Response 200:**
```json
{
  "group_count": 2,
  "total_iuran": 600000,
  "win_count": 1
}
```

---

### PUT `/api/users/push-token`
Daftarkan Expo push token untuk notifikasi push.

**Request:**
```json
{ "expo_push_token": "ExponentPushToken[xxxxxx]" }
```

**Response 200:**
```json
{ "message": "Push token tersimpan" }
```

---

## 3. Groups

### POST `/api/groups`
Buat grup arisan baru. **Maks 3 grup aktif per user. Nama profil wajib diisi terlebih dahulu.**

**Request:**
```json
{
  "name": "Arisan Kantor",
  "nominal": 200000,
  "frekuensi": "monthly",
  "jumlah_periode": 6,
  "mode_undian": "random"
}
```

| Field | Type | Validasi |
|-------|------|----------|
| `name` | string | 3–100 karakter |
| `nominal` | integer | 10.000–100.000.000 |
| `frekuensi` | enum | `weekly` \| `biweekly` \| `monthly` |
| `jumlah_periode` | integer | 2–100 |
| `mode_undian` | enum | `fixed` \| `random` \| `manual` |

**Response 201:**
```json
{
  "group": {
    "id": "ddbfd938-...",
    "name": "Arisan Kantor",
    "ketua_id": "a62745a2-...",
    "nominal": 200000,
    "frekuensi": "monthly",
    "jumlah_periode": 6,
    "mode_undian": "random",
    "invite_code": "AASG9RVF",
    "invite_code_expires_at": "2026-06-10T09:21:53.05+00:00",
    "status": "recruiting",
    "created_at": "2026-06-03T09:21:53.163185+00:00"
  }
}
```

---

### GET `/api/groups`
Daftar semua grup yang diikuti user.

**Response 200:**
```json
{
  "groups": [
    {
      "id": "ddbfd938-...",
      "name": "Arisan Kantor",
      "status": "active",
      "nominal": 200000,
      "frekuensi": "monthly",
      "jumlah_periode": 6,
      "mode_undian": "random",
      "urutan_saya": 1,
      "invite_code": "AASG9RVF",
      "created_at": "..."
    }
  ]
}
```

---

### GET `/api/groups/code/:code`
Preview grup via invite code sebelum join. **Tidak perlu join terlebih dahulu.**

**Response 200:**
```json
{
  "id": "ddbfd938-...",
  "name": "Arisan Kantor",
  "nominal": 200000,
  "frekuensi": "monthly",
  "jumlah_periode": 6,
  "mode_undian": "random",
  "status": "recruiting",
  "member_count": 3
}
```

---

### POST `/api/groups/join`
Bergabung ke grup via invite code.

**Request:**
```json
{ "invite_code": "AASG9RVF" }
```

**Response 200:**
```json
{
  "group": { ... },
  "message": "Berhasil bergabung ke grup \"Arisan Kantor\""
}
```

**Error Conditions:**
- `404` — Kode tidak valid atau sudah tidak aktif
- `400` — Kode expired / grup tidak recruiting / sudah bergabung / nama belum diisi

---

### GET `/api/groups/:id`
Detail grup. **Hanya untuk anggota.**

**Response 200:**
```json
{
  "group": {
    "id": "...",
    "name": "Arisan Kantor",
    "ketua_id": "...",
    "nominal": 200000,
    "frekuensi": "monthly",
    "jumlah_periode": 6,
    "mode_undian": "random",
    "status": "active",
    "invite_code": "AASG9RVF"
  },
  "members": [
    {
      "user_id": "...",
      "urutan": 1,
      "jumlah_tukar": 0,
      "users": { "id": "...", "name": "Ars Dev" }
    }
  ],
  "current_period_id": "fe0504cc-...",
  "current_period": 1
}
```
> `phone` **tidak** dikembalikan di response ini untuk privasi

---

### POST `/api/groups/:id/start`
Ketua memulai arisan. Grup berubah dari `recruiting` → `active`, periode 1 dibuat.

**Response 200:**
```json
{
  "message": "Arisan berhasil dimulai",
  "period": { "id": "...", "periode_ke": 1, "status": "active" }
}
```

---

### POST `/api/groups/:id/invite`
Ketua regenerate invite code baru (8 karakter, berlaku 7 hari).

**Response 200:**
```json
{
  "invite_code": "NEWCODE1",
  "expires_at": "2026-06-10T..."
}
```

---

### PUT `/api/groups/:id/urutan`
Ketua atur ulang urutan anggota. **Hanya sebelum arisan dimulai.**

**Request:**
```json
{ "urutan": ["user_id_1", "user_id_2", "user_id_3"] }
```

**Response 200:**
```json
{ "message": "Urutan berhasil diperbarui" }
```

---

### GET `/api/groups/:id/periods`
Daftar semua periode grup.

**Response 200:**
```json
{
  "periods": [
    {
      "id": "...",
      "periode_ke": 1,
      "status": "closed",
      "tanggal_pelaksanaan": "2026-07-01",
      "jatuh_tempo": "2026-06-28"
    }
  ]
}
```

---

### POST `/api/groups/:id/periods/:periodId/close`
Ketua menutup periode aktif dan membuka periode berikutnya. **Undian wajib dilakukan dulu.**

**Response 200:**
```json
{
  "message": "Periode 1 ditutup. Periode 2 telah dimulai.",
  "closed_period": 1,
  "next_period": 2,
  "group_completed": false,
  "unpaid_count": 0
}
```

> Jika `group_completed: true` — grup selesai, tidak ada periode berikutnya.

---

### PUT `/api/groups/:groupId/periods/:periodId/tanggal`
Set tanggal pelaksanaan. Bisa dilakukan ketua **atau** pemenang undian periode tersebut.

**Request:**
```json
{ "tanggal_pelaksanaan": "2026-07-15" }
```

**Response 200:**
```json
{ "message": "Tanggal pelaksanaan berhasil diperbarui", "jatuh_tempo": "2026-07-12" }
```
> `jatuh_tempo` dihitung otomatis = `tanggal_pelaksanaan - 3 hari`

---

### GET `/api/groups/:id/buku`
Buku kas grup — semua payment per periode per anggota. **Hanya ketua.**

**Response 200:**
```json
{
  "group_name": "Arisan Kantor",
  "nominal": 200000,
  "member_count": 6,
  "periods": [
    {
      "periode_ke": 1,
      "status": "closed",
      "winner_name": "Ars Dev",
      "arisan_amount": 1200000,
      "payments": [
        { "name": "Ars Dev", "status": "confirmed" },
        { "name": "Aris", "status": "late" }
      ]
    }
  ]
}
```

---

### GET `/api/groups/:id/hutang`
Daftar anggota yang sudah menang tapi masih hutang iuran berikutnya. **Hanya ketua.**

**Response 200:**
```json
{
  "debtors": [
    {
      "user_id": "...",
      "name": "Aris",
      "won_period": 2,
      "total_hutang": 400000,
      "detail": [
        { "period_number": 3, "status": "pending" },
        { "period_number": 4, "status": "pending" }
      ]
    }
  ],
  "member_count": 6,
  "expected_per_winner": 1200000,
  "actual_per_winner": 1000000,
  "impact_per_winner": 200000
}
```

---

### POST `/api/groups/:id/kabur/:memberId/resolve`
Ketua selesaikan hutang anggota kabur.

**Request:**
```json
{ "mode": "kick_writeoff" }
```
> `kick_writeoff` — kick + catat kerugian  
> `netting` — offset hutang dengan iuran yang sudah dibayar

**Response 200:**
```json
{ "message": "Hutang anggota berhasil diselesaikan", "mode": "kick_writeoff" }
```

---

### GET `/api/groups/:id/activity-log`
Log aktivitas grup (buat grup, join, undian, dsb). **Hanya anggota.**

**Query:** `?limit=20&offset=0`

**Response 200:**
```json
{
  "logs": [
    {
      "id": "...",
      "action": "undian",
      "description": "Undian mode random: pemenang Ars Dev",
      "actor_id": "...",
      "created_at": "..."
    }
  ]
}
```

---

### DELETE `/api/groups/:id/members/:memberId`
Ketua kick anggota. **Hanya saat masih recruiting.**

**Response 200:**
```json
{ "message": "Anggota berhasil dikeluarkan" }
```

---

### DELETE `/api/groups/:id/leave`
User keluar dari grup. **Tidak bisa jika sudah active.**

**Response 200:**
```json
{ "message": "Berhasil keluar dari grup" }
```

---

### DELETE `/api/groups/:id`
Ketua hapus grup. **Hanya jika masih recruiting.**

**Response 200:**
```json
{ "message": "Grup berhasil dihapus" }
```

---

### POST `/api/groups/:groupId/messages`
Kirim pesan chat di grup.

**Request:**
```json
{ "content": "Halo semua!" }
```
> Max 500 karakter

**Response 201:**
```json
{
  "message": {
    "id": "...",
    "group_id": "...",
    "user_id": "...",
    "content": "Halo semua!",
    "created_at": "2026-06-03T09:02:01.969454+00:00",
    "user": { "name": "Ars Dev" }
  }
}
```

---

### POST `/api/groups/:groupId/typing`
Broadcast "sedang mengetik" ke anggota lain (via Supabase Realtime).

**Response 200:** `{ "ok": true }`

### GET `/api/groups/:groupId/typing`
Cek siapa yang sedang mengetik.

**Response 200:**
```json
{ "typing": [{ "id": "...", "name": "Ars Dev" }] }
```

---

## 4. Payments

### GET `/api/payments/:groupId/:periodId`
Status pembayaran semua anggota untuk periode tertentu.

**Response 200:**
```json
{
  "payments": [
    {
      "id": "...",
      "period_id": "...",
      "user_id": "...",
      "status": "confirmed",
      "confirmed_by": "...",
      "confirmed_at": "2026-06-02T19:35:17.433+00:00",
      "created_at": "...",
      "users": { "id": "...", "name": "Ars Dev" }
    }
  ]
}
```

**Status values:** `pending` | `confirmed` | `late`

---

### POST `/api/payments/:groupId/:periodId/confirm`
Ketua konfirmasi payment anggota. **Idempotent** — aman dipanggil berulang.

**Request:**
```json
{ "member_id": "199864cf-..." }
```

**Response 200:**
```json
{ "message": "Pembayaran berhasil dikonfirmasi" }
```

---

### DELETE `/api/payments/:groupId/:periodId/confirm`
Ketua batalkan konfirmasi payment (kembalikan ke `pending`).

**Request:**
```json
{ "member_id": "199864cf-..." }
```

**Response 200:**
```json
{ "message": "Konfirmasi pembayaran dibatalkan" }
```

---

## 5. Undian

### GET `/api/groups/:id/winners`
Riwayat pemenang undian grup.

**Response 200:**
```json
{
  "winners": [
    {
      "id": "...",
      "user_id": "...",
      "period_id": "...",
      "created_at": "...",
      "arisan_amount": 1200000,
      "periods": { "periode_ke": 1 },
      "users": { "name": "Ars Dev" }
    }
  ]
}
```

---

### POST `/api/groups/:id/undian`
Ketua jalankan undian. **Mode harus sesuai mode_undian grup.**

**Request (mode random):**
```json
{ "mode": "random", "period_id": "fe0504cc-..." }
```

**Request (mode fixed):**
```json
{ "mode": "fixed", "period_id": "fe0504cc-..." }
```
> Fixed: pemenang = anggota dengan urutan sesuai `periode_ke`

**Request (mode manual):**
```json
{ "mode": "manual", "period_id": "fe0504cc-...", "winner_id": "199864cf-..." }
```

**Response 200:**
```json
{
  "winner": { "id": "...", "name": "Aris" },
  "periode_ke": 1
}
```

> **Multi-putaran:** Jika semua anggota sudah pernah menang (untuk mode random), sistem otomatis reset eligibility dan pilih acak dari semua anggota.

---

## 6. Swaps

### GET `/api/swaps/my`
Semua swap request yang melibatkan user (sebagai requester atau target).

**Response 200:**
```json
{
  "swaps": [
    {
      "id": "...",
      "group_id": "...",
      "requester_id": "...",
      "target_id": "...",
      "status": "pending",
      "created_at": "...",
      "requester": { "name": "Ars Dev" },
      "target": { "name": "Aris" }
    }
  ]
}
```

**Status values:** `pending` | `waiting_ketua` | `approved` | `rejected` | `ketua_pending` | `ketua_rejected`

---

### GET `/api/swaps/group/:groupId`
Semua swap request dalam grup. **Hanya ketua.**

---

### POST `/api/swaps`
Anggota request tukar giliran dengan anggota lain.

**Request:**
```json
{ "group_id": "...", "target_id": "..." }
```

**Business Rules:**
- Max 2x swap approved per user per grup
- Tidak bisa swap jika sudah pernah menang undian
- Tidak bisa swap jika target sudah menang undian
- Tidak bisa swap jika giliran sudah berlangsung

**Response 201:**
```json
{ "swap": { "id": "...", "status": "pending", ... } }
```

---

### POST `/api/swaps/ketua`
Ketua inisiasi tukar giliran antara dua anggota.

**Request:**
```json
{ "group_id": "...", "member_a_id": "...", "member_b_id": "..." }
```

**Response 201:**
```json
{ "swap": { "id": "...", "status": "ketua_pending", ... } }
```

---

### POST `/api/swaps/:id/respond`
Target merespons swap request dari anggota lain.

**Request:**
```json
{ "response": "accepted" }
```
> `accepted` | `rejected`

**Response 200:**
```json
{ "status": "waiting_ketua" }
```
> Jika accepted → status menjadi `waiting_ketua` (menunggu persetujuan ketua)

---

### POST `/api/swaps/:id/approve`
Ketua approve atau reject swap yang sudah diterima target.

**Request:**
```json
{ "decision": "approved" }
```
> `approved` | `ketua_rejected`

**Response 200:**
```json
{ "status": "approved" }
```

---

## 7. Notifications

### GET `/api/notifications`
Daftar notifikasi user dengan cursor pagination.

**Query params:**
- `limit` — int, default 20, max 50
- `before` — UUID notifikasi terakhir (untuk load more)

**Response 200:**
```json
{
  "notifications": [
    {
      "id": "...",
      "type": "payment_confirmed",
      "title": "Pembayaran Dikonfirmasi",
      "body": "Pembayaran kamu untuk periode 1 telah dikonfirmasi ketua.",
      "data": { "group_id": "...", "period_id": "..." },
      "is_read": false,
      "created_at": "..."
    }
  ],
  "unread_count": 3,
  "has_more": false
}
```

**Notification types:**
| Type | Trigger |
|------|---------|
| `payment_confirmed` | Ketua konfirmasi iuran |
| `undian_done` | Undian selesai |
| `swap_request` | Ada permintaan tukar giliran |
| `swap_approved` | Swap disetujui/ditolak |
| `payment_late` | Iuran keterlambatan (notif ke ketua) |

---

### PATCH `/api/notifications/read-all`
Tandai semua notifikasi sebagai sudah dibaca.

**Response 200:**
```json
{ "message": "Semua notifikasi ditandai sudah dibaca" }
```

---

### PATCH `/api/notifications/:id/read`
Tandai satu notifikasi sebagai sudah dibaca.

**Response 200:**
```json
{ "message": "Notifikasi ditandai sudah dibaca" }
```

---

## 8. Cron (Internal)

Semua endpoint ini dilindungi header `X-Cron-Secret`.  
Dipanggil otomatis via GitHub Actions setiap jam 08:00 WIB.

### GET `/api/cron/payment-reminder`
Kirim reminder ke anggota yang belum bayar (jatuh tempo hari ini / 3 hari lagi).

### GET `/api/cron/pelaksanaan-reminder`
Kirim reminder pelaksanaan arisan ke semua anggota (7 hari sebelum tanggal pelaksanaan).

### GET `/api/payments/cron/mark-late`
Tandai payment `pending` yang sudah melewati jatuh tempo menjadi `late`.

---

## 9. Health

### GET `/health`
Status server. **Tidak perlu auth.**

**Response 200:**
```json
{ "status": "ok", "timestamp": "2026-06-03T09:02:01.969Z" }
```

---

## Error Codes Quick Reference

| Endpoint | Error | HTTP |
|----------|-------|------|
| send-otp | Rate limit 5x/jam | 429 |
| verify-otp | OTP salah/expired | 400 |
| create group | Nama belum diisi | 400 |
| create group | Sudah 3 grup aktif | 403 |
| join group | Kode tidak valid | 404 |
| join group | Grup penuh/sudah selesai | 400 |
| start group | Bukan ketua | 403 |
| confirm payment | Bukan ketua | 400 |
| undian | Mode tidak sesuai | 400 |
| undian | Sudah dilakukan | 400 |
| swap | Sudah 2x swap | 400 |
| swap | Target/requester sudah menang | 400 |

---

## Business Rules Penting

1. **Max 3 grup aktif per user** — berlaku untuk ketua maupun anggota
2. **Invite code berlaku 7 hari** atau hingga grup penuh (member = jumlah_periode)
3. **Grup tidak bisa diedit** setelah periode pertama aktif
4. **Swap maks 2x** per user per grup (status `approved`)
5. **Swap tidak bisa** jika target/requester sudah pernah menang undian
6. **Tutup periode** wajib undian dulu — tidak bisa skip
7. **winners INSERT-ONLY** — tidak ada endpoint update/delete winner
8. **Notif dedup** — satu type notifikasi per hari per user (via `notif_log`)
9. **Multi-putaran arisan** — jika semua anggota sudah menang, random reset dari semua anggota
