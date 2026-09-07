import 'server-only';
import { createHash } from 'node:crypto';
import { toFile } from 'openai';
import type { AiAttachmentKind, AiDeliveryChannel } from '@prisma/client';
import { AI_ATTACHMENT_MAX_COUNT } from '@/lib/ai-assistant';
import { prisma } from '@/server/db/client';
import { conversationExpiry } from './history';
import { getAiAssistantConfig, getOpenAiClient } from './config';
import { safeOpenAiError } from './provider-error';

export type DetectedAiAttachment = {
  kind: AiAttachmentKind;
  mimeType: string;
  extension: string;
};

export type AssistantModelAttachment = DetectedAiAttachment & {
  id: string;
  fileName: string;
  content: Uint8Array;
  extractedText: string | null;
};

export class AiAttachmentError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'AiAttachmentError';
  }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

export function detectAiAttachment(bytes: Uint8Array): DetectedAiAttachment | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { kind: 'DOCUMENT', mimeType: 'application/pdf', extension: 'pdf' };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { kind: 'RECEIPT_IMAGE', mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'RECEIPT_IMAGE', mimeType: 'image/png', extension: 'png' };
  }
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WEBP')) {
    return { kind: 'RECEIPT_IMAGE', mimeType: 'image/webp', extension: 'webp' };
  }
  if (asciiAt(bytes, 0, 'OggS')) {
    return { kind: 'AUDIO', mimeType: 'audio/ogg', extension: 'ogg' };
  }
  if (asciiAt(bytes, 0, 'RIFF') && asciiAt(bytes, 8, 'WAVE')) {
    return { kind: 'AUDIO', mimeType: 'audio/wav', extension: 'wav' };
  }
  if (asciiAt(bytes, 0, 'fLaC')) {
    return { kind: 'AUDIO', mimeType: 'audio/flac', extension: 'flac' };
  }
  if (asciiAt(bytes, 0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { kind: 'AUDIO', mimeType: 'audio/mpeg', extension: 'mp3' };
  }
  if (asciiAt(bytes, 4, 'ftyp')) {
    return { kind: 'AUDIO', mimeType: 'audio/mp4', extension: 'm4a' };
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: 'AUDIO', mimeType: 'audio/webm', extension: 'webm' };
  }
  return null;
}

const DECLARED_MIME_ALIASES: Record<string, Set<string>> = {
  'application/pdf': new Set(['application/pdf']),
  'image/jpeg': new Set(['image/jpeg', 'image/jpg']),
  'image/png': new Set(['image/png']),
  'image/webp': new Set(['image/webp']),
  'audio/ogg': new Set(['audio/ogg', 'application/ogg']),
  'audio/wav': new Set(['audio/wav', 'audio/x-wav', 'audio/wave']),
  'audio/flac': new Set(['audio/flac', 'audio/x-flac']),
  'audio/mpeg': new Set(['audio/mpeg', 'audio/mp3']),
  'audio/mp4': new Set(['audio/mp4', 'audio/x-m4a', 'video/mp4', 'application/mp4']),
  'audio/webm': new Set(['audio/webm', 'video/webm']),
};

function declaredMimeMatches(declaredMimeType: string | null | undefined, detectedMimeType: string): boolean {
  const declared = declaredMimeType?.split(';', 1)[0].trim().toLowerCase();
  if (!declared || declared === 'application/octet-stream') return true;
  return DECLARED_MIME_ALIASES[detectedMimeType]?.has(declared) ?? false;
}

function safeFilename(value: string | null | undefined, detected: DetectedAiAttachment): string {
  const source = (value ?? `atlas-attachment.${detected.extension}`)
    .normalize('NFKC')
    .replace(/[\r\n\0/\\]/g, '-')
    .replace(/[^\p{L}\p{N}._ -]+/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  const stem = source.replace(/\.[^.]+$/, '').trim().slice(0, 80) || 'atlas-attachment';
  return `${stem}.${detected.extension}`;
}

export function validateAiAttachment(input: {
  bytes: Uint8Array;
  declaredMimeType?: string | null;
  fileName?: string | null;
  maxBytes?: number;
}): DetectedAiAttachment & { fileName: string } {
  const maxBytes = input.maxBytes ?? getAiAssistantConfig().mediaMaxBytes;
  if (input.bytes.byteLength === 0) throw new AiAttachmentError('attachment_empty');
  if (input.bytes.byteLength > maxBytes) throw new AiAttachmentError('attachment_too_large');
  const detected = detectAiAttachment(input.bytes);
  if (!detected) throw new AiAttachmentError('attachment_type_unsupported');
  if (!declaredMimeMatches(input.declaredMimeType, detected.mimeType)) {
    throw new AiAttachmentError('attachment_mime_mismatch');
  }
  return { ...detected, fileName: safeFilename(input.fileName, detected) };
}

export async function storeAiAttachment(input: {
  userId: string;
  channel: AiDeliveryChannel;
  bytes: Uint8Array;
  declaredMimeType?: string | null;
  fileName?: string | null;
  telegramFileId?: string | null;
}) {
  const validated = validateAiAttachment(input);
  const checksum = createHash('sha256').update(input.bytes).digest('hex');
  const existing = await prisma.aiAttachment.findUnique({
    where: { userId_checksum: { userId: input.userId, checksum } },
  });
  if (existing && existing.expiresAt > new Date() && existing.status !== 'REJECTED') return existing;

  const data = {
    channel: input.channel,
    kind: validated.kind,
    status: 'READY' as const,
    fileName: validated.fileName,
    mimeType: validated.mimeType,
    byteSize: input.bytes.byteLength,
    content: Uint8Array.from(input.bytes),
    telegramFileId: input.telegramFileId ?? null,
    extractedText: null,
    errorCode: null,
    expiresAt: conversationExpiry(),
  };
  if (existing) return prisma.aiAttachment.update({ where: { id: existing.id }, data });
  return prisma.aiAttachment.create({ data: { userId: input.userId, checksum, ...data } });
}

export async function loadAssistantAttachments(input: {
  userId: string;
  attachmentIds?: string[];
}): Promise<AssistantModelAttachment[]> {
  const ids = [...new Set(input.attachmentIds ?? [])];
  if (!ids.length) return [];
  if (ids.length > AI_ATTACHMENT_MAX_COUNT) throw new AiAttachmentError('attachment_count_exceeded');
  const rows = await prisma.aiAttachment.findMany({
    where: {
      id: { in: ids },
      userId: input.userId,
      status: 'READY',
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      kind: true,
      mimeType: true,
      fileName: true,
      content: true,
      extractedText: true,
      byteSize: true,
    },
  });
  if (rows.length !== ids.length) throw new AiAttachmentError('attachment_not_found');
  const totalBytes = rows.reduce((sum, row) => sum + row.byteSize, 0);
  if (totalBytes > getAiAssistantConfig().mediaMaxBytes) throw new AiAttachmentError('attachment_total_too_large');
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (!row) throw new AiAttachmentError('attachment_not_found');
    return { ...row, extension: row.fileName.split('.').pop() ?? 'bin', content: Uint8Array.from(row.content) };
  });
}

export async function transcribeAiAttachment(attachment: AssistantModelAttachment): Promise<string> {
  if (attachment.kind !== 'AUDIO') throw new AiAttachmentError('attachment_not_audio');
  if (attachment.extractedText?.trim()) return attachment.extractedText.trim();
  await prisma.aiAttachment.update({
    where: { id: attachment.id },
    data: { status: 'PROCESSING', errorCode: null },
  });
  try {
    const file = await toFile(attachment.content, attachment.fileName, { type: attachment.mimeType });
    const result = await getOpenAiClient().audio.transcriptions.create({
      file,
      model: getAiAssistantConfig().transcriptionModel,
      response_format: 'json',
      languages: ['ar', 'en'],
      keywords: ['Laheeb', 'Atlas', 'IQD', 'Baghdad', 'Erbil', 'SKU'],
    });
    const text = result.text.trim();
    if (!text) throw new AiAttachmentError('transcription_empty');
    await prisma.aiAttachment.update({
      where: { id: attachment.id },
      data: { status: 'READY', extractedText: text, errorCode: null },
    });
    return text;
  } catch (error) {
    const provider = safeOpenAiError(error);
    const code = error instanceof AiAttachmentError
      ? error.code
      : provider?.code ?? 'transcription_failed';
    await prisma.aiAttachment.update({
      where: { id: attachment.id },
      data: { status: 'READY', errorCode: code.slice(0, 120) },
    }).catch(() => undefined);
    throw new AiAttachmentError('transcription_failed');
  }
}

export async function linkAssistantAttachments(input: {
  attachmentIds: string[];
  userId: string;
  conversationId: string;
  sourceMessageId: string;
  pendingActionId?: string;
}): Promise<void> {
  if (!input.attachmentIds.length) return;
  await prisma.aiAttachment.updateMany({
    where: {
      id: { in: input.attachmentIds },
      userId: input.userId,
      OR: [{ sourceMessageId: null }, { sourceMessageId: input.sourceMessageId }],
    },
    data: {
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      ...(input.pendingActionId ? { pendingActionId: input.pendingActionId } : {}),
    },
  });
}
