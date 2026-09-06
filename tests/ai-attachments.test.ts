import { describe, expect, it } from 'vitest';
import { AiChatRequestSchema } from '@/lib/ai-assistant';
import {
  AiAttachmentError,
  detectAiAttachment,
  validateAiAttachment,
} from '@/server/ai/attachments';

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe('AI attachment safety contracts', () => {
  it('detects supported files from content rather than names or headers', () => {
    expect(detectAiAttachment(new TextEncoder().encode('%PDF-1.7'))).toMatchObject({
      kind: 'DOCUMENT',
      mimeType: 'application/pdf',
    });
    expect(detectAiAttachment(bytes(0xff, 0xd8, 0xff, 0xe0))).toMatchObject({
      kind: 'RECEIPT_IMAGE',
      mimeType: 'image/jpeg',
    });
    expect(detectAiAttachment(bytes(0x4f, 0x67, 0x67, 0x53))).toMatchObject({
      kind: 'AUDIO',
      mimeType: 'audio/ogg',
    });
    expect(detectAiAttachment(new TextEncoder().encode('<script>alert(1)</script>'))).toBeNull();
  });

  it('rejects MIME spoofing, unsupported content, empty files, and oversized files', () => {
    const pdf = new TextEncoder().encode('%PDF-1.7 test');
    expect(() => validateAiAttachment({
      bytes: pdf,
      declaredMimeType: 'image/jpeg',
      fileName: 'receipt.jpg',
      maxBytes: 100,
    })).toThrowError(new AiAttachmentError('attachment_mime_mismatch'));
    expect(() => validateAiAttachment({ bytes: bytes(), maxBytes: 100 }))
      .toThrowError(new AiAttachmentError('attachment_empty'));
    expect(() => validateAiAttachment({ bytes: new TextEncoder().encode('plain text'), maxBytes: 100 }))
      .toThrowError(new AiAttachmentError('attachment_type_unsupported'));
    expect(() => validateAiAttachment({ bytes: pdf, maxBytes: 4 }))
      .toThrowError(new AiAttachmentError('attachment_too_large'));
  });

  it('sanitizes uploaded names and pins the detected extension', () => {
    const result = validateAiAttachment({
      bytes: new TextEncoder().encode('%PDF-1.7 test'),
      declaredMimeType: 'application/octet-stream',
      fileName: '../../invoice\r\n.jpg',
      maxBytes: 100,
    });
    expect(result.fileName).toBe('..-..-invoice--.pdf');
    expect(result.fileName).not.toContain('/');
    expect(result.fileName).not.toContain('\n');
  });

  it('accepts attachment-only chat requests but keeps IDs bounded and strict', () => {
    expect(AiChatRequestSchema.parse({
      attachmentIds: ['cm12345678901234567890123'],
      locale: 'en',
    })).toMatchObject({ attachmentIds: ['cm12345678901234567890123'] });
    expect(() => AiChatRequestSchema.parse({ message: '', locale: 'en' })).toThrow();
    expect(() => AiChatRequestSchema.parse({
      attachmentIds: Array.from({ length: 5 }, (_, index) => `cm12345678901234567890${index}xx`),
      locale: 'en',
    })).toThrow();
  });
});
