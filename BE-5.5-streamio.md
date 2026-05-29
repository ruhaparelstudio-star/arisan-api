# BE-5.5 — Stream.io Chat

> **Prompt pembuka:**
> ```
> Baca CLAUDE.md dan PROGRESS.md. Konfirmasi BE-5 selesai.
> Scope: src/services/streamio.ts (full), retrofit groups.ts, endpoint token.
> INGAT: Stream.io gagal tidak boleh gagalkan operasi utama (grup, join, undian).
> ```

---

## Konteks

`streamio.ts` saat ini hanya stub — `sendSystemMessage` hanya `logger.info`.
Stream.io dipakai untuk **group chat per arisan grup**. Frontend (React Native)
connect langsung ke Stream.io menggunakan user token yang di-generate backend.

---

## `src/services/streamio.ts` — full implementation

```typescript
import { StreamChat } from 'stream-chat';
import { logger } from '../utils/logger';

// Singleton client — inisialisasi sekali
function getClient(): StreamChat {
  return StreamChat.getInstance(
    process.env.STREAM_API_KEY!,
    process.env.STREAM_API_SECRET!
  );
}

// Generate token untuk frontend connect
export function generateUserToken(userId: string): string {
  return getClient().createToken(userId);
}

// Buat channel saat grup dibuat — dipanggil dari groups.ts
export async function createGroupChannel(groupId: string, groupName: string, ketuaId: string): Promise<void> {
  try {
    const client = getClient();
    const channel = client.channel('messaging', `group-${groupId}`, {
      name: groupName,
      created_by_id: ketuaId,
      members: [ketuaId],
    });
    await channel.create();
  } catch (err) {
    logger.error('Stream createGroupChannel failed', { groupId, err });
  }
}

// Tambah member ke channel saat user join grup
export async function addMemberToChannel(groupId: string, userId: string): Promise<void> {
  try {
    const client = getClient();
    const channel = client.channel('messaging', `group-${groupId}`);
    await channel.addMembers([userId]);
  } catch (err) {
    logger.error('Stream addMemberToChannel failed', { groupId, userId, err });
  }
}

// Hapus member dari channel saat user leave grup
export async function removeMemberFromChannel(groupId: string, userId: string): Promise<void> {
  try {
    const client = getClient();
    const channel = client.channel('messaging', `group-${groupId}`);
    await channel.removeMembers([userId]);
  } catch (err) {
    logger.error('Stream removeMemberFromChannel failed', { groupId, userId, err });
  }
}

// Kirim system message (undian result, dsb)
export async function sendSystemMessage(groupId: string, text: string): Promise<void> {
  try {
    const client = getClient();
    const channel = client.channel('messaging', `group-${groupId}`);
    await channel.sendMessage({ text, user_id: 'system-bot' });
    logger.info('Stream system message sent', { groupId, text });
  } catch (err) {
    logger.error('Stream sendSystemMessage failed', { groupId, err });
    // Tidak throw — kegagalan Stream tidak boleh gagalkan operasi utama
  }
}
```

---

## Retrofit `src/routes/groups.ts`

Tambah 3 panggilan ke streamio.ts di route yang sudah ada:

```typescript
// POST /api/groups — setelah insert group_members ketua:
await createGroupChannel(group.id, body.name, userId);

// POST /api/groups/join — setelah insert group_members:
await addMemberToChannel(group.id, userId);

// DELETE /api/groups/:id/leave — setelah delete group_members:
await removeMemberFromChannel(groupId, userId);
```

> Jangan ubah logika validasi — hanya tambah panggilan Stream setelah DB operation berhasil.

---

## Endpoint Token

```typescript
// GET /api/users/stream-token
// Auth: jwtAuth
// Return: { token: string }
// Gunakan generateUserToken(userId) dari streamio.ts
```

Tambahkan ke `src/routes/users.ts` — bukan route baru.

---

## npm install

```bash
npm install stream-chat
```

Konfirmasi di awal sesi sebelum lanjut implementasi.

---

## Checklist

```
[ ] npm install stream-chat berhasil, type-check clean?
[ ] createGroupChannel dipanggil setelah POST /api/groups berhasil?
[ ] addMemberToChannel dipanggil setelah POST /api/groups/join berhasil?
[ ] removeMemberFromChannel dipanggil setelah DELETE /:id/leave berhasil?
[ ] sendSystemMessage sekarang benar-benar mengirim (bukan hanya logger.info)?
[ ] GET /api/users/stream-token mengembalikan token yang valid?
[ ] Semua fungsi Stream tidak throw — kegagalan hanya di-log?
[ ] Uji: buat grup → cek channel terbuat di Stream.io dashboard?
```

## Update PROGRESS.md — WAJIB

```
Commit: "feat(be): stream.io chat — channel management + user token"
Update BE-5.5 (tambah section baru di PROGRESS.md).
```

**Sesi berikutnya:** `BE-6-notifikasi.md`

---
---
