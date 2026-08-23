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

const TelegramMessageSchema = z.object({
  message_id: z.number().int(),
  from: TelegramUserSchema.optional(),
  chat: TelegramChatSchema,
  date: z.number().int().optional(),
  text: z.string().optional(),
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
};

export function supportedTelegramUpdate(update: TelegramUpdate): SupportedTelegramUpdate | null {
  if (update.message?.from) {
    return {
      updateId: String(update.update_id),
      type: 'message',
      user: update.message.from,
      chatId: String(update.message.chat.id),
      privateChat: update.message.chat.type === 'private',
      text: update.message.text,
      messageId: update.message.message_id,
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
