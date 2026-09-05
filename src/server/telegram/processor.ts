import 'server-only';
import type { Prisma } from '@prisma/client';
import type { AiStreamEvent } from '@/lib/ai-assistant';
import { shouldRetryTelegramProcessing } from '@/lib/telegram-errors';
import type { CurrentUser } from '@/server/auth/session';
import { prisma } from '@/server/db/client';
import { cancelPendingAction, confirmPendingAction } from '@/server/ai/actions';
import { getAiAssistantConfig } from '@/server/ai/config';
import { aiDebugId } from '@/server/ai/hash';
import { processAssistantMessage } from '@/server/ai/service';
import { storeAiAttachment } from '@/server/ai/attachments';
import { aiDeliveryStatusText, getUserAiDeliveryHealth, replayUserAiDeliveries } from '@/server/ai/deliveries';
import { deliverAiReportsToTelegram } from '@/server/ai/reports';
import {
  answerTelegramCallback,
  downloadTelegramFile,
  editTelegramMessage,
  sendTelegramMessage,
  sendTelegramTyping,
} from './api';
import { getTelegramConfig } from './config';
import {
  parseTelegramCallback,
  quickActionKeyboard,
  renderAssistantEvents,
  statusKeyboard,
  TELEGRAM_QUICK_PROMPTS,
  type TelegramRenderedReply,
} from './render';
import { supportedTelegramUpdate, telegramLocale, TelegramUpdateSchema, type SupportedTelegramUpdate } from './schemas';

function currentUser(record: { id: string; email: string; name: string; role: CurrentUser['role']; branchId: string | null; defaultFinanceAccountId?: string | null }): CurrentUser {
  return record;
}

function commandName(text: string | undefined): string | null {
  if (!text?.startsWith('/')) return null;
  return text.trim().split(/\s+/, 1)[0].split('@')[0].toLowerCase();
}

function accessMessage(locale: 'ar' | 'en', telegramUserId: string, allowlisted: boolean): string {
  if (locale === 'ar') {
    return allowlisted
      ? `معرّف تيليغرام الخاص بك: ${telegramUserId}\n\nأنت ضمن قائمة السماح، لكن يجب على المالك أو المدير ربط هذا المعرّف بحسابك في أطلس من الإدارة ← الموصلات.`
      : `معرّف تيليغرام الخاص بك: ${telegramUserId}\n\nلا يوجد حساب أطلس مرتبط بهذا المعرّف. اطلب من المالك أو المدير إضافتك وربط حسابك من الإدارة ← الموصلات.`;
  }
  return allowlisted
    ? `Your Telegram ID is ${telegramUserId}.\n\nYou are allowlisted, but an Owner or Admin must link this ID to your Atlas account under Administration → Connectors.`
    : `Your Telegram ID is ${telegramUserId}.\n\nNo Atlas account is linked to this ID. Ask an Owner or Admin to add and link it under Administration → Connectors.`;
}

function helpMessage(locale: 'ar' | 'en', name?: string): string {
  if (locale === 'ar') {
    return `${name ? `مرحباً ${name}.\n\n` : ''}يمكنك سؤال مساعد أطلس عن المبيعات والطلبات والمخزون والمصروفات والعملاء. كما يمكنه تجهيز طلب أو عميل أو مصروف أو شراء أو تحديث حالة للمراجعة.\n\nالقراءة فورية. أي تغيير يعرض معاينة ويحتاج تأكيدك.`;
  }
  return `${name ? `Hello ${name}.\n\n` : ''}Ask Atlas AI about sales, orders, inventory, spending, and customers. It can also prepare an order, customer, expense, purchase, or status update for review.\n\nReads are immediate. Every change shows a preview and requires your confirmation.`;
}

async function updateIdentity(input: SupportedTelegramUpdate) {
  const userId = String(input.user.id);
  return prisma.telegramIdentity.upsert({
    where: { telegramUserId: userId },
    create: {
      telegramUserId: userId,
      privateChatId: input.privateChat ? input.chatId : null,
      username: input.user.username,
      firstName: input.user.first_name,
      lastName: input.user.last_name,
      languageCode: input.user.language_code,
      lastSeenAt: new Date(),
    },
    update: {
      privateChatId: input.privateChat ? input.chatId : undefined,
      username: input.user.username,
      firstName: input.user.first_name,
      lastName: input.user.last_name,
      languageCode: input.user.language_code,
      lastSeenAt: new Date(),
    },
    include: {
      user: {
        select: { id: true, email: true, name: true, role: true, branchId: true, defaultFinanceAccountId: true, isActive: true },
      },
    },
  });
}

async function setReplyMessageId(updateId: string, messageId: number): Promise<void> {
  await prisma.telegramUpdate.update({ where: { id: updateId }, data: { replyMessageId: String(messageId) } });
}

async function ensureWorkingMessage(input: {
  updateRecordId: string;
  chatId: string;
  existingReplyMessageId: string | null;
  locale: 'ar' | 'en';
}): Promise<number> {
  const existing = Number(input.existingReplyMessageId);
  if (Number.isInteger(existing) && existing > 0) return existing;
  const sent = await sendTelegramMessage({
    chatId: input.chatId,
    text: input.locale === 'ar' ? 'جاري مراجعة بيانات أطلس…' : 'Checking Atlas…',
  });
  await setReplyMessageId(input.updateRecordId, sent.message_id);
  return sent.message_id;
}

async function deliverReply(input: {
  updateRecordId: string;
  chatId: string;
  replyMessageId?: number;
  existingReplyMessageId: string | null;
  locale: 'ar' | 'en';
  rendered: TelegramRenderedReply;
}): Promise<void> {
  const chunks = input.rendered.chunks.length
    ? input.rendered.chunks
    : [input.locale === 'ar' ? 'تمت معالجة الطلب.' : 'The request was processed.'];
  const target = input.replyMessageId ?? await ensureWorkingMessage(input);
  await editTelegramMessage({
    chatId: input.chatId,
    messageId: target,
    text: chunks[0],
    keyboard: chunks.length === 1 ? input.rendered.keyboard : undefined,
  });
  for (let index = 1; index < chunks.length; index += 1) {
    await sendTelegramMessage({
      chatId: input.chatId,
      text: chunks[index],
      keyboard: index === chunks.length - 1 ? input.rendered.keyboard : undefined,
    });
  }
}

function storedEvents(message: { content: string | null; payload: Prisma.JsonValue | null }): AiStreamEvent[] {
  const events: AiStreamEvent[] = message.content ? [{ type: 'text_delta', delta: message.content }] : [];
  if (message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)) {
    const payload = message.payload as { events?: unknown };
    if (Array.isArray(payload.events)) events.push(...payload.events as AiStreamEvent[]);
  }
  return events;
}

async function replaySavedReply(input: {
  aiMessageId: string;
  locale: 'ar' | 'en';
  origin: string;
}): Promise<TelegramRenderedReply | null> {
  const message = await prisma.aiMessage.findUnique({
    where: { id: input.aiMessageId },
    select: { id: true, content: true, payload: true },
  });
  if (!message) return null;
  return renderAssistantEvents(storedEvents(message), {
    locale: input.locale,
    origin: input.origin,
    messageId: message.id,
  });
}

async function clarificationSelection(input: {
  messageId: string;
  index: number;
  userId: string;
}): Promise<{ conversationId: string; message: string } | null> {
  const message = await prisma.aiMessage.findFirst({
    where: {
      id: input.messageId,
      conversation: { userId: input.userId, channel: 'TELEGRAM', status: 'ACTIVE' },
    },
    select: { conversationId: true, payload: true },
  });
  if (!message?.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) return null;
  const events = (message.payload as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  const clarification = events.find((event) => (
    Boolean(event) && typeof event === 'object' && (event as { type?: string }).type === 'clarification'
  )) as { clarification?: { field?: string; choices?: Array<{ value?: string; label?: string }> } } | undefined;
  const choice = clarification?.clarification?.choices?.[input.index];
  if (!choice?.value) return null;
  return {
    conversationId: message.conversationId,
    message: `${clarification?.clarification?.field ?? 'selection'}: ${choice.value}`,
  };
}

async function markComplete(
  id: string,
  status: 'SUCCEEDED' | 'IGNORED',
  data: { errorCode?: string | null } = {},
): Promise<void> {
  await prisma.telegramUpdate.update({
    where: { id },
    data: { status, processedAt: new Date(), errorCode: null, ...data },
  });
}

export async function processTelegramUpdate(telegramUpdateId: string): Promise<void> {
  const claimed = await prisma.telegramUpdate.updateMany({
    where: { id: telegramUpdateId, status: { in: ['RECEIVED', 'QUEUED', 'FAILED'] } },
    data: { status: 'PROCESSING', attempts: { increment: 1 }, lastAttemptAt: new Date(), errorCode: null },
  });
  if (claimed.count !== 1) return;

  const receipt = await prisma.telegramUpdate.findUnique({ where: { id: telegramUpdateId } });
  if (!receipt) return;
  const debugId = aiDebugId('telegram');
  let telegram: SupportedTelegramUpdate | null = null;
  let locale: 'ar' | 'en' = 'en';

  try {
    const parsed = TelegramUpdateSchema.safeParse(receipt.payload);
    if (!parsed.success) {
      await markComplete(receipt.id, 'IGNORED', { errorCode: 'invalid_update' });
      return;
    }
    telegram = supportedTelegramUpdate(parsed.data);
    if (!telegram || !telegram.privateChat) {
      await markComplete(receipt.id, 'IGNORED', { errorCode: 'unsupported_chat' });
      return;
    }
    locale = telegramLocale(telegram.user.language_code, telegram.text);
    const identity = await updateIdentity(telegram);
    await prisma.telegramUpdate.update({
      where: { id: receipt.id },
      data: { identityId: identity.id, telegramUserId: identity.telegramUserId, privateChatId: telegram.chatId },
    });

    if (telegram.type === 'callback_query' && telegram.callbackId) {
      await answerTelegramCallback(telegram.callbackId).catch((error) => {
        console.warn('Telegram callback acknowledgement failed', {
          updateId: receipt.updateId,
          errorCode: error instanceof Error ? error.message : 'telegram_callback_failed',
        });
      });
    }

    const config = getTelegramConfig();
    const allowlisted = config.allowedUserIds.has(identity.telegramUserId);
    if (identity.status !== 'ACTIVE' || !identity.user?.isActive) {
      await sendTelegramMessage({
        chatId: telegram.chatId,
        text: accessMessage(locale, identity.telegramUserId, allowlisted),
      });
      await markComplete(receipt.id, 'SUCCEEDED');
      return;
    }
    const user = currentUser(identity.user);
    const aiConfig = getAiAssistantConfig();
    if (!aiConfig.enabled || !aiConfig.apiKeyConfigured) {
      await sendTelegramMessage({
        chatId: telegram.chatId,
        text: locale === 'ar' ? 'مساعد أطلس غير متاح حالياً.' : 'Atlas AI is currently unavailable.',
      });
      await markComplete(receipt.id, 'SUCCEEDED');
      return;
    }

    const command = commandName(telegram.text);
    if (command === '/status') {
      const health = await getUserAiDeliveryHealth(user.id);
      const linked = locale === 'ar'
        ? `مرتبط بحساب أطلس: ${user.name}\nالدور: ${user.role}`
        : `Linked Atlas user: ${user.name}\nRole: ${user.role}`;
      await sendTelegramMessage({
        chatId: telegram.chatId,
        text: `${linked}\n\n${aiDeliveryStatusText(health, locale)}`,
        keyboard: statusKeyboard(locale, health.retryable),
      });
      await markComplete(receipt.id, 'SUCCEEDED');
      return;
    }
    if (command === '/start' || command === '/help') {
      await sendTelegramMessage({ chatId: telegram.chatId, text: helpMessage(locale, user.name), keyboard: quickActionKeyboard(locale) });
      await markComplete(receipt.id, 'SUCCEEDED');
      return;
    }
    if (command === '/new') {
      await prisma.aiConversation.updateMany({
        where: { userId: user.id, channel: 'TELEGRAM', externalThreadId: telegram.chatId, status: 'ACTIVE' },
        data: { status: 'ARCHIVED' },
      });
      await sendTelegramMessage({
        chatId: telegram.chatId,
        text: locale === 'ar' ? 'بدأت محادثة جديدة. ماذا تريد أن تفعل؟' : 'New conversation started. What would you like to do?',
        keyboard: quickActionKeyboard(locale),
      });
      await markComplete(receipt.id, 'SUCCEEDED');
      return;
    }

    const callback = parseTelegramCallback(telegram.callbackData);
    if (callback?.type === 'delivery-replay') {
      const replay = await replayUserAiDeliveries({ userId: user.id });
      const health = await getUserAiDeliveryHealth(user.id);
      const text = locale === 'ar'
        ? `تمت محاولة ${replay.attempted} عملية تسليم؛ اكتملت ${replay.completed} وتعذر ${replay.failed}.\n\n${aiDeliveryStatusText(health, locale)}`
        : `Attempted ${replay.attempted} deliveries; ${replay.completed} completed and ${replay.failed} failed.\n\n${aiDeliveryStatusText(health, locale)}`;
      await deliverReply({
        updateRecordId: receipt.id,
        chatId: telegram.chatId,
        replyMessageId: telegram.messageId,
        existingReplyMessageId: receipt.replyMessageId,
        locale,
        rendered: { chunks: [text], keyboard: statusKeyboard(locale, health.retryable) },
      });
      await markComplete(receipt.id, 'SUCCEEDED');
      return;
    }
    if (callback?.type === 'action') {
      const chatId = telegram.chatId;
      const confirmationChallenge = callback.command === 'high-confirm'
        ? await prisma.aiPendingAction.findFirst({
            where: { id: callback.actionId, userId: user.id, status: 'PENDING' },
            select: { confirmationChallenge: true },
          })
        : null;
      const result = callback.command === 'cancel'
        ? await cancelPendingAction({ actionId: callback.actionId, user, locale })
        : await confirmPendingAction({
            actionId: callback.actionId,
            user,
            locale,
            confirmationText: callback.command === 'high-confirm'
              ? confirmationChallenge?.confirmationChallenge ?? undefined
              : undefined,
          });
      const events: AiStreamEvent[] = [{
        type: 'action_result',
        actionId: result.actionId,
        status: result.status,
        message: result.message,
        href: result.href,
        invoiceHref: result.invoiceHref,
        documentHref: result.documentHref,
        documentStatus: result.documentStatus,
        committed: result.committed,
        requiresSecondConfirmation: result.requiresSecondConfirmation,
        confirmationChallenge: result.confirmationChallenge,
      }];
      await deliverReply({
        updateRecordId: receipt.id,
        chatId,
        replyMessageId: telegram.messageId,
        existingReplyMessageId: receipt.replyMessageId,
        locale,
        rendered: renderAssistantEvents(events, { locale, origin: receipt.origin }),
      });
      await markComplete(receipt.id, 'SUCCEEDED');
      return;
    }

    let message = telegram.text?.trim() ?? '';
    const attachmentIds: string[] = [];
    if (telegram.media) {
      if (telegram.media.fileSize && telegram.media.fileSize > aiConfig.mediaMaxBytes) {
        throw new Error('attachment_too_large');
      }
      const downloaded = await downloadTelegramFile(telegram.media.fileId, aiConfig.mediaMaxBytes);
      const attachment = await storeAiAttachment({
        userId: user.id,
        channel: 'TELEGRAM',
        bytes: downloaded.bytes,
        declaredMimeType: telegram.media.mimeType,
        fileName: telegram.media.fileName,
        telegramFileId: telegram.media.fileId,
      });
      attachmentIds.push(attachment.id);
    }
    let conversationId: string | undefined;
    if (callback?.type === 'quick') message = TELEGRAM_QUICK_PROMPTS[callback.key]?.[locale] ?? '';
    if (callback?.type === 'choice') {
      const selected = await clarificationSelection({ messageId: callback.messageId, index: callback.index, userId: user.id });
      if (selected) {
        message = selected.message;
        conversationId = selected.conversationId;
      }
    }
    if (!message && !attachmentIds.length) {
      await sendTelegramMessage({
        chatId: telegram.chatId,
        text: locale === 'ar'
          ? 'أرسل رسالة نصية أو صورة وصل أو ملف PDF أو رسالة صوتية، أو اختر أحد الأزرار.'
          : 'Send text, a receipt image, a PDF, or a voice message, or choose one of the buttons.',
        keyboard: quickActionKeyboard(locale),
      });
      await markComplete(receipt.id, 'IGNORED', { errorCode: 'unsupported_message' });
      return;
    }

    const savedReply = receipt.aiMessageId
      ? await replaySavedReply({ aiMessageId: receipt.aiMessageId, locale, origin: receipt.origin })
      : null;
    if (savedReply) {
      await deliverReply({
        updateRecordId: receipt.id,
        chatId: telegram.chatId,
        replyMessageId: telegram.type === 'callback_query' ? telegram.messageId : undefined,
        existingReplyMessageId: receipt.replyMessageId,
        locale,
        rendered: savedReply,
      });
      await markComplete(receipt.id, 'SUCCEEDED');
      return;
    }

    await sendTelegramTyping(telegram.chatId).catch(() => undefined);
    const workingMessageId = telegram.type === 'callback_query' && telegram.messageId
      ? telegram.messageId
      : await ensureWorkingMessage({
          updateRecordId: receipt.id,
          chatId: telegram.chatId,
          existingReplyMessageId: receipt.replyMessageId,
          locale,
        });
    const result = await processAssistantMessage({
      user,
      locale,
      message,
      attachmentIds,
      conversationId,
      channel: 'TELEGRAM',
      externalThreadId: telegram.chatId,
      onEvent: () => undefined,
    });
    await prisma.telegramUpdate.update({
      where: { id: receipt.id },
      data: { conversationId: result.conversationId, aiMessageId: result.messageId, debugId: result.debugId },
    });
    await deliverReply({
      updateRecordId: receipt.id,
      chatId: telegram.chatId,
      replyMessageId: workingMessageId,
      existingReplyMessageId: receipt.replyMessageId,
      locale,
      rendered: renderAssistantEvents(result.events, {
        locale,
        origin: receipt.origin,
        messageId: result.messageId,
      }),
    });
    await deliverAiReportsToTelegram({
      events: result.events,
      userId: user.id,
      chatId: telegram.chatId,
      locale,
      origin: receipt.origin,
    });
    await markComplete(receipt.id, 'SUCCEEDED');
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.split(':')[0].slice(0, 120) : 'telegram_processing_failed';
    const retryable = shouldRetryTelegramProcessing(error);
    console.error('Telegram AI update failed', { telegramUpdateId, debugId, errorCode, retryable });
    await prisma.telegramUpdate.update({
      where: { id: telegramUpdateId },
      data: {
        status: retryable ? 'FAILED' : 'IGNORED',
        errorCode,
        debugId,
        processedAt: retryable ? null : new Date(),
      },
    }).catch(() => undefined);
    if (!retryable && receipt.attempts <= 1 && telegram?.privateChat) {
      const text = locale === 'ar'
        ? `تعذر إكمال الطلب الآن. لم تتغير أي بيانات. رمز المتابعة: ${debugId}`
        : `The request could not be completed. No data was changed. Debug ID: ${debugId}`;
      const messageId = Number(receipt.replyMessageId);
      if (Number.isInteger(messageId) && messageId > 0) {
        await editTelegramMessage({ chatId: telegram.chatId, messageId, text }).catch(() => undefined);
      } else {
        await sendTelegramMessage({ chatId: telegram.chatId, text }).catch(() => undefined);
      }
    }
    if (retryable) throw error;
  }
}
