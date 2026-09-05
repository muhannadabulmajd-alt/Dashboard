import 'server-only';
import { requireTelegramConfig } from './config';

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

export type TelegramBot = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

export type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
};

export type TelegramFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

export type InlineKeyboard = Array<Array<{ text: string; callback_data?: string; url?: string }>>;

async function telegramRequest<T>(method: string, payload?: Record<string, unknown>): Promise<T> {
  const { token } = requireTelegramConfig();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null) as TelegramResponse<T> | null;
  if (!response.ok || !body?.ok || body.result === undefined) {
    const error = new Error(`telegram_api_${body?.error_code ?? response.status}`);
    Object.assign(error, { retryable: response.status === 429 || response.status >= 500, description: body?.description });
    throw error;
  }
  return body.result;
}

async function telegramMultipartRequest<T>(method: string, payload: FormData): Promise<T> {
  const { token } = requireTelegramConfig();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    body: payload,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null) as TelegramResponse<T> | null;
  if (!response.ok || !body?.ok || body.result === undefined) {
    const error = new Error(`telegram_api_${body?.error_code ?? response.status}`);
    Object.assign(error, { retryable: response.status === 429 || response.status >= 500, description: body?.description });
    throw error;
  }
  return body.result;
}

export function getTelegramBot(): Promise<TelegramBot> {
  return telegramRequest<TelegramBot>('getMe');
}

export function getTelegramWebhookInfo(): Promise<TelegramWebhookInfo> {
  return telegramRequest<TelegramWebhookInfo>('getWebhookInfo');
}

export function getTelegramFile(fileId: string): Promise<TelegramFile> {
  return telegramRequest<TelegramFile>('getFile', { file_id: fileId });
}

async function boundedResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('telegram_file_body_missing');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('attachment_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function downloadTelegramFile(fileId: string, maxBytes: number): Promise<{
  bytes: Uint8Array;
  file: TelegramFile;
}> {
  const file = await getTelegramFile(fileId);
  if (file.file_size && file.file_size > maxBytes) throw new Error('attachment_too_large');
  if (!file.file_path || file.file_path.includes('..') || !/^[A-Za-z0-9_./-]+$/.test(file.file_path)) {
    throw new Error('telegram_file_path_invalid');
  }
  const { token } = requireTelegramConfig();
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
    method: 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const error = new Error(`telegram_file_${response.status}`);
    Object.assign(error, { retryable: response.status === 429 || response.status >= 500 });
    throw error;
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('attachment_too_large');
  const bytes = await boundedResponseBytes(response, maxBytes);
  return { bytes, file };
}

export async function registerTelegramWebhook(url: string): Promise<void> {
  const { webhookSecret } = requireTelegramConfig();
  await telegramRequest<boolean>('setWebhook', {
    url,
    secret_token: webhookSecret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
  });
  await telegramRequest<boolean>('setMyCommands', {
    commands: [
      { command: 'start', description: 'Start Atlas AI' },
      { command: 'help', description: 'Show available actions' },
      { command: 'new', description: 'Start a new conversation' },
      { command: 'status', description: 'Check Atlas bot access' },
    ],
  });
}

export function sendTelegramMessage(input: {
  chatId: string;
  text: string;
  keyboard?: InlineKeyboard;
}): Promise<{ message_id: number }> {
  return telegramRequest('sendMessage', {
    chat_id: input.chatId,
    text: input.text,
    disable_web_page_preview: true,
    reply_markup: input.keyboard?.length ? { inline_keyboard: input.keyboard } : undefined,
  });
}

export function sendTelegramDocument(input: {
  chatId: string;
  document: Uint8Array;
  filename: string;
  caption?: string;
  keyboard?: InlineKeyboard;
}): Promise<{ message_id: number }> {
  const payload = new FormData();
  const document = new Uint8Array(input.document.byteLength);
  document.set(input.document);
  payload.set('chat_id', input.chatId);
  payload.set('document', new Blob([document.buffer], { type: 'application/pdf' }), input.filename);
  if (input.caption) payload.set('caption', input.caption);
  if (input.keyboard?.length) payload.set('reply_markup', JSON.stringify({ inline_keyboard: input.keyboard }));
  return telegramMultipartRequest('sendDocument', payload);
}

export function editTelegramMessage(input: {
  chatId: string;
  messageId: number;
  text: string;
  keyboard?: InlineKeyboard;
}): Promise<unknown> {
  return telegramRequest('editMessageText', {
    chat_id: input.chatId,
    message_id: input.messageId,
    text: input.text,
    disable_web_page_preview: true,
    reply_markup: input.keyboard?.length ? { inline_keyboard: input.keyboard } : undefined,
  });
}

export async function answerTelegramCallback(callbackId: string, text?: string): Promise<void> {
  await telegramRequest<boolean>('answerCallbackQuery', {
    callback_query_id: callbackId,
    text,
    show_alert: false,
  });
}

export async function sendTelegramTyping(chatId: string): Promise<void> {
  await telegramRequest<boolean>('sendChatAction', { chat_id: chatId, action: 'typing' });
}
