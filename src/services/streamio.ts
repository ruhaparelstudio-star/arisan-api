import { StreamChat } from 'stream-chat';
import { logger } from '../utils/logger';
import { supabase } from '../db/supabase';

function getClient(): StreamChat {
  return StreamChat.getInstance(process.env.STREAM_API_KEY!, process.env.STREAM_API_SECRET!);
}

export function generateUserToken(userId: string): string {
  return getClient().createToken(userId);
}

export async function createGroupChannel(
  groupId: string,
  groupName: string,
  ketuaId: string
): Promise<void> {
  try {
    const client = getClient();
    const channel = client.channel('messaging', `group-${groupId}`, {
      name: groupName,
      created_by_id: ketuaId,
      members: [ketuaId],
    } as Record<string, unknown>);
    await channel.create();
  } catch (err) {
    logger.error('Stream createGroupChannel failed', { groupId, err });
  }
}

export async function addMemberToChannel(groupId: string, userId: string): Promise<void> {
  try {
    const client = getClient();
    const channel = client.channel('messaging', `group-${groupId}`);
    await channel.addMembers([userId]);
  } catch (err) {
    logger.error('Stream addMemberToChannel failed', { groupId, userId, err });
  }
}

export async function removeMemberFromChannel(groupId: string, userId: string): Promise<void> {
  try {
    const client = getClient();
    const channel = client.channel('messaging', `group-${groupId}`);
    await channel.removeMembers([userId]);
  } catch (err) {
    logger.error('Stream removeMemberFromChannel failed', { groupId, userId, err });
  }
}

export async function sendSystemMessage(groupId: string, text: string): Promise<void> {
  // Tulis ke Supabase messages table agar tampil di ChatScreen mobile
  // user_id null = system message (tidak ada FK constraint violation)
  try {
    await supabase.from('messages').insert({
      group_id: groupId,
      user_id: null,
      content: text,
    });
  } catch (err) {
    logger.error('Supabase sendSystemMessage failed', { groupId, err });
  }

  // Tetap kirim ke Stream.io (best-effort, tidak block)
  try {
    const client = getClient();
    const channel = client.channel('messaging', `group-${groupId}`);
    await channel.sendMessage({ text, user_id: 'system-bot' });
    logger.info('Stream system message sent', { groupId, text });
  } catch (err) {
    logger.error('Stream sendSystemMessage failed', { groupId, err });
  }
}
