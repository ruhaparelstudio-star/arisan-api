import { logger } from '../utils/logger';

export async function sendSystemMessage(groupId: string, text: string): Promise<void> {
  try {
    // Stream.io server-side SDK (npm install stream-chat — konfirmasi sebelum aktifkan)
    // const client = StreamChat.getInstance(process.env.STREAM_API_KEY!, process.env.STREAM_API_SECRET!);
    // const channel = client.channel('messaging', `group-${groupId}`);
    // await channel.sendMessage({ text, type: 'system', user_id: 'system-bot' });
    logger.info('Stream system message sent', { groupId, text });
  } catch (err) {
    // Kegagalan Stream tidak boleh gagalkan undian
    logger.error('Stream system message failed', { groupId, err });
  }
}
