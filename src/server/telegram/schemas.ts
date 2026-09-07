import { z } from 'zod';

const TelegramUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
}).passthrough();

const TelegramChatSchema = z.object({
  id: z.number().int(),
  type: z.string(),
}).passthrough();

const TelegramPhotoSchema = z.object({
  file_id: z.string().min(1),
  file_unique_id: z.string().optional(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  file_size: z.number().int().nonnegative().optional(),
}).passthrough();

const TelegramFileSchema = z.object({
  file_id: z.string().min(1),
  file_unique_id: z.string().optional(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
  file_size: z.number().int().nonnegative().optional(),
}).passthrough();

const TelegramMessageSchema = z.object({
  message_id: z.number().int(),
  from: TelegramUserSchema.optional(),
  chat: TelegramChatSchema,
  date: z.number().int().optional(),
  text: z.string().optional(),
  caption: z.string().optional(),
  photo: z.array(TelegramPhotoSchema).optional(),
  document: TelegramFileSchema.optional(),
  voice: TelegramFileSchema.extend({ duration: z.number().int().nonnegative().optional() }).optional(),
  audio: TelegramFileSchema.extend({ duration: z.number().int().nonnegative().optional() }).optional(),
}).passthrough();

const TelegramCallbackSchema = z.object({
  id: z.string().min(1),
  from: TelegramUserSchema,
  message: TelegramMessageSchema.optional(),
  data: z.string().max(64).optional(),
}).passthrough();

export const TelegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: TelegramMessageSchema.optional(),
  callback_query: TelegramCallbackSchema.optional(),
}).passthrough();

export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;
export type TelegramUser = z.infer<typeof TelegramUserSchema>;

export type TelegramMedia = {
  type: 'photo' | 'document' | 'voice' | 'audio';
  fileId: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
};

export type SupportedTelegramUpdate = {
  updateId: string;
  type: 'message' | 'callback_query';
  user: TelegramUser;
  chatId: string;
  privateChat: boolean;
  text?: string;
  callbackId?: string;
  callbackData?: string;
  messageId?: number;
  media?: TelegramMedia;
};

function messageMedia(message: z.infer<typeof TelegramMessageSchema>): TelegramMedia | undefined {
  if (message.voice) {
    return {
      type: 'voice',
      fileId: message.voice.file_id,
      fileName: message.voice.file_name ?? `telegram-voice-${message.message_id}.ogg`,
      mimeType: message.voice.mime_type ?? 'audio/ogg',
      fileSize: message.voice.file_size ?? null,
    };
  }
  if (message.audio) {
    return {
      type: 'audio',
      fileId: message.audio.file_id,
      fileName: message.audio.file_name ?? `telegram-audio-${message.message_id}`,
      mimeType: message.audio.mime_type ?? null,
      fileSize: message.audio.file_size ?? null,
    };
  }
  if (message.document) {
    return {
      type: 'document',
      fileId: message.document.file_id,
      fileName: message.document.file_name ?? `telegram-document-${message.message_id}`,
      mimeType: message.document.mime_type ?? null,
      fileSize: message.document.file_size ?? null,
    };
  }
  const photo = message.photo?.at(-1);
  if (photo) {
    return {
      type: 'photo',
      fileId: photo.file_id,
      fileName: `telegram-photo-${message.message_id}.jpg`,
      mimeType: 'image/jpeg',
      fileSize: photo.file_size ?? null,
    };
  }
  return undefined;
}

export function supportedTelegramUpdate(update: TelegramUpdate): SupportedTelegramUpdate | null {
  if (update.message?.from) {
    return {
      updateId: String(update.update_id),
      type: 'message',
      user: update.message.from,
      chatId: String(update.message.chat.id),
      privateChat: update.message.chat.type === 'private',
      text: update.message.text ?? update.message.caption,
      messageId: update.message.message_id,
      media: messageMedia(update.message),
    };
  }
  const callback = update.callback_query;
  if (callback?.message) {
    return {
      updateId: String(update.update_id),
      type: 'callback_query',
      user: callback.from,
      chatId: String(callback.message.chat.id),
      privateChat: callback.message.chat.type === 'private',
      callbackId: callback.id,
      callbackData: callback.data,
      messageId: callback.message.message_id,
    };
  }
  return null;
}

export function telegramLocale(languageCode: string | undefined, text: string | undefined): 'ar' | 'en' {
  if (/^ar(?:-|$)/i.test(languageCode ?? '') || /[\u0600-\u06FF]/.test(text ?? '')) return 'ar';
  return 'en';
}
