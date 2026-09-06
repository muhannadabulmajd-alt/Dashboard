import 'server-only';

import { send } from '@vercel/queue';

export const AI_DOCUMENT_QUEUE_TOPIC = 'ai-document-delivery';

export type AiDocumentQueuePayload = { documentId: string };

export async function enqueueAiDocument(documentId: string): Promise<void> {
  await send<AiDocumentQueuePayload>(
    AI_DOCUMENT_QUEUE_TOPIC,
    { documentId },
    {
      idempotencyKey: `ai-document:${documentId}`,
      retentionSeconds: 24 * 60 * 60,
    },
  );
}
