import { Hono } from 'hono';
import { z } from 'zod';
import { zv } from '../utils/zv';
import { jwtAuth } from '../middleware/auth';
import { supabase } from '../db/supabase';
import * as ss from '../services/swaps';
import * as gs from '../services/groups';
import { insertNotification } from '../services/notifications';

type Variables = { userId: string };

export const swapsRoute = new Hono<{ Variables: Variables }>();
swapsRoute.use('*', jwtAuth);

const SWAP_SELECT = '*, requester:users!requester_id(name), target:users!target_id(name)';

// GET /api/swaps/my — harus sebelum /:id agar tidak tertangkap sebagai param
swapsRoute.get('/my', async (c) => {
  const userId = c.get('userId');
  const { data } = await supabase
    .from('swap_requests')
    .select(SWAP_SELECT)
    .or(`requester_id.eq.${userId},target_id.eq.${userId}`)
    .order('created_at', { ascending: false });
  return c.json({ swaps: data ?? [] });
});

// GET /api/swaps/group/:groupId — harus sebelum /:id
swapsRoute.get('/group/:groupId', async (c) => {
  const userId = c.get('userId');
  const groupId = c.req.param('groupId');

  const { data: group } = await supabase
    .from('groups')
    .select('ketua_id')
    .eq('id', groupId)
    .single();

  if (!group) return c.json({ error: 'Grup tidak ditemukan' }, 404);
  if (group.ketua_id !== userId)
    return c.json({ error: 'Hanya ketua yang bisa melihat semua swap di grup' }, 403);

  const { data } = await supabase
    .from('swap_requests')
    .select(SWAP_SELECT)
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  return c.json({ swaps: data ?? [] });
});

// POST /api/swaps/ketua — ketua inisiasi tukar giliran antar dua anggota (Mode 2)
// Harus sebelum POST / agar tidak tertangkap route '/'
swapsRoute.post(
  '/ketua',
  zv(
    'json',
    z.object({
      member_a_id: z.string().uuid(),
      member_b_id: z.string().uuid(),
      group_id: z.string().uuid(),
    })
  ),
  async (c) => {
    const ketuaId = c.get('userId');
    const { member_a_id, member_b_id, group_id } = c.req.valid('json');

    const result = await ss.createKetuaSwapRequest(ketuaId, member_a_id, member_b_id, group_id);
    if (result.error) return c.json({ error: result.error }, 400);

    await gs.logActivity(
      group_id,
      ketuaId,
      'urutan_updated',
      `Ketua meminta tukar giliran antara dua anggota — menunggu persetujuan target`
    );

    return c.json({ swap: result.swap }, 201);
  }
);

// POST /api/swaps
swapsRoute.post(
  '/',
  zv(
    'json',
    z.object({
      target_id: z.string().uuid(),
      group_id: z.string().uuid(),
    })
  ),
  async (c) => {
    const requesterId = c.get('userId');
    const { target_id, group_id } = c.req.valid('json');

    if (requesterId === target_id)
      return c.json({ error: 'Kamu tidak bisa menukar giliran dengan dirimu sendiri' }, 400);

    // Cek apakah target sudah pernah menang undian — tidak boleh ditukar
    const { data: targetWin } = await supabase
      .from('winners')
      .select('id')
      .eq('group_id', group_id)
      .eq('user_id', target_id)
      .limit(1)
      .maybeSingle();

    if (targetWin)
      return c.json(
        {
          error:
            'Target sudah pernah memenangkan undian dan menerima uang arisan. Tidak bisa tukar giliran dengan penerima arisan.',
        },
        400
      );

    // Cek apakah requester sendiri sudah pernah menang (tidak bisa tukar setelah menang)
    const { data: requesterWin } = await supabase
      .from('winners')
      .select('id')
      .eq('group_id', group_id)
      .eq('user_id', requesterId)
      .limit(1)
      .maybeSingle();

    if (requesterWin)
      return c.json(
        {
          error:
            'Kamu sudah pernah memenangkan undian. Tukar giliran hanya untuk anggota yang belum mendapat giliran.',
        },
        400
      );

    const result = await ss.createSwapRequest(requesterId, target_id, group_id);
    if (result.error) return c.json({ error: result.error }, 400);

    return c.json({ swap: result.swap }, 201);
  }
);

// POST /api/swaps/:id/respond
swapsRoute.post(
  '/:id/respond',
  zv('json', z.object({ response: z.enum(['accepted', 'rejected']) })),
  async (c) => {
    const targetId = c.get('userId');
    const swapId = c.req.param('id');
    const { response } = c.req.valid('json');

    const result = await ss.respondSwap(swapId, targetId, response);
    if (result.error) return c.json({ error: result.error }, 400);

    return c.json({ status: result.status });
  }
);

// POST /api/swaps/:id/approve
swapsRoute.post(
  '/:id/approve',
  zv('json', z.object({ decision: z.enum(['approved', 'ketua_rejected']) })),
  async (c) => {
    const ketuaId = c.get('userId');
    const swapId = c.req.param('id');
    const { decision } = c.req.valid('json');

    const result = await ss.approveSwap(swapId, ketuaId, decision);
    if (result.error) return c.json({ error: result.error }, 400);

    // Notifikasi ke requester dan target — fire-and-forget
    void (async () => {
      const { data: swap } = await supabase
        .from('swap_requests')
        .select('requester_id, target_id, group_id')
        .eq('id', swapId)
        .single();
      if (!swap) return;
      const approved = decision === 'approved';
      await insertNotification(
        swap.requester_id,
        'swap_approved',
        approved ? 'Tukar Giliran Disetujui' : 'Tukar Giliran Ditolak',
        approved
          ? 'Ketua menyetujui request tukar giliran kamu.'
          : 'Ketua menolak request tukar giliran kamu.',
        { group_id: swap.group_id, swap_id: swapId }
      ).catch(() => {});
      if (approved) {
        await insertNotification(
          swap.target_id,
          'swap_approved',
          'Tukar Giliran Disetujui',
          'Ketua menyetujui tukar giliran kamu dengan anggota lain.',
          { group_id: swap.group_id, swap_id: swapId }
        ).catch(() => {});
      }
    })();

    return c.json({ status: result.status });
  }
);
