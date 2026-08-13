import { NextResponse, type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { can } from '@/lib/rbac';
import { QuickOrderDraftSchema } from '@/lib/ai-quick-order';
import { aiDebugId } from '@/server/ai/hash';
import { getOrCreateConversation, saveAiMessage } from '@/server/ai/history';
import { isHttpResponse, requireAiApiUser } from '@/server/ai/http';
import { executeAssistantTool } from '@/server/ai/tools';
import { prisma } from '@/server/db/client';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const userOrResponse = await requireAiApiUser();
  if (isHttpResponse(userOrResponse)) return userOrResponse;
  if (!can(userOrResponse.role, 'manage:orders')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const parsed = QuickOrderDraftSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const draft = parsed.data;
  const debugId = aiDebugId('quick-order');
  try {
    const selectedCustomer = draft.customerExternalId
      ? await prisma.customer.findFirst({
          where: { externalId: draft.customerExternalId, isActive: true },
          select: { externalId: true, nameEn: true, nameAr: true },
        })
      : null;
    if (draft.customerExternalId && !selectedCustomer) {
      return NextResponse.json({ error: 'customer_not_found' }, { status: 400 });
    }
    const products = await prisma.product.findMany({
      where: { sku: { in: draft.lines.map((line) => line.sku) }, isActive: true },
      select: { sku: true, nameEn: true, nameAr: true },
    });
    if (products.length !== new Set(draft.lines.map((line) => line.sku)).size) {
      return NextResponse.json({ error: 'product_not_found' }, { status: 400 });
    }
    const productBySku = new Map(products.map((product) => [product.sku, product]));
    const customerName = selectedCustomer?.nameEn || selectedCustomer?.nameAr || (draft.locale === 'ar' ? 'طلب بدون عميل' : 'Walk-in order');
    const lineSummary = draft.lines.map((line) => {
      const product = productBySku.get(line.sku)!;
      return `${line.quantity} x ${draft.locale === 'ar' ? product.nameAr : product.nameEn}`;
    }).join(', ');
    const userContent = draft.locale === 'ar'
      ? `طلب سريع: ${customerName} · ${lineSummary}`
      : `Quick order: ${customerName} · ${lineSummary}`;
    const conversation = await getOrCreateConversation({
      conversationId: draft.conversationId,
      userId: userOrResponse.id,
      locale: draft.locale,
      firstMessage: userContent,
    });
    const userMessage = await saveAiMessage({
      conversationId: conversation.id,
      role: 'USER',
      content: userContent,
    });
    const execution = await executeAssistantTool('prepare_create_order', {
      customerQuery: draft.customerExternalId,
      newCustomer: null,
      placedAt: draft.placedAt,
      channel: draft.channel,
      governorate: draft.governorate,
      fulfillmentMethod: draft.fulfillmentMethod,
      status: draft.status,
      deliveryFee: 0,
      deliveryCost: 0,
      orderDiscount: 0,
      extraCharges: 0,
      notes: draft.notes,
      financeMode: 'AUTO',
      financeAccountQuery: null,
      financeProviderQuery: null,
      financePaidAmount: null,
      financePaymentMethod: null,
      financePaymentDate: null,
      financeDueDate: null,
      lines: draft.lines.map((line) => ({
        productQuery: line.sku,
        quantity: line.quantity,
        unitGrossPrice: null,
        lineDiscount: 0,
      })),
    }, {
      conversationId: conversation.id,
      sourceMessageId: userMessage.id,
      user: userOrResponse,
      locale: draft.locale,
      now: new Date(),
    });
    const assistantContent = draft.locale === 'ar'
      ? 'راجع الطلب أدناه، ثم أكده عندما يكون صحيحاً.'
      : 'Review the order below, then confirm it when everything is correct.';
    const assistantMessage = await saveAiMessage({
      conversationId: conversation.id,
      role: 'ASSISTANT',
      kind: execution.events.some((event) => event.type === 'action_preview') ? 'ACTION_PREVIEW' : 'CLARIFICATION',
      content: assistantContent,
      payload: { events: execution.events } as unknown as Prisma.InputJsonValue,
    });
    return NextResponse.json({
      conversationId: conversation.id,
      messages: [
        { id: userMessage.id, role: userMessage.role, content: userMessage.content, events: [], createdAt: userMessage.createdAt.toISOString() },
        { id: assistantMessage.id, role: assistantMessage.role, content: assistantMessage.content, events: execution.events, createdAt: assistantMessage.createdAt.toISOString() },
      ],
    });
  } catch (error) {
    console.error('Quick order preparation failed', { debugId, error });
    return NextResponse.json({
      error: 'prepare_failed',
      message: draft.locale === 'ar'
        ? `تعذر تحضير الطلب. لم يتم تغيير أي بيانات. رمز المتابعة: ${debugId}`
        : `Could not prepare the order. No data was changed. Debug ID: ${debugId}`,
      debugId,
    }, { status: 500 });
  }
}
