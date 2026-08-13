import { Bot, ShieldCheck } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { AssistantWorkspace } from '@/components/ai-assistant/AssistantWorkspace';
import { Card, CardContent, PageHeader } from '@/components/ui/primitives';
import { getAiAssistantConfig } from '@/server/ai/config';
import { prisma } from '@/server/db/client';
import { getPageContext } from '@/server/page-context';
import { getOrderCatalog } from '@/server/records/order-catalog';
import { getListOptions } from '@/server/lists/resolver';
import { getOrderOperationalDefaults } from '@/server/records/order-defaults';

export default async function AiAssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, user } = await getPageContext(params, searchParams, 'use:ai-assistant');
  const t = await getTranslations('aiAssistant');
  const config = getAiAssistantConfig();
  const available = config.enabled && config.apiKeyConfigured;
  const [rows, catalog, customers, channels, governorates, fulfillment, statuses, defaults] = available ? await Promise.all([prisma.aiConversation.findMany({
    where: { userId: user.id, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    select: {
      id: true,
      title: true,
      locale: true,
      lastMessageAt: true,
      _count: { select: { messages: true } },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
  }),
  getOrderCatalog(locale, locale === 'ar' ? 'بدون مجموعة' : 'Ungrouped'),
  prisma.customer.findMany({
    where: { isActive: true, externalId: { not: null } },
    select: {
      externalId: true,
      nameEn: true,
      nameAr: true,
      phone: true,
      governorate: true,
      orders: {
        orderBy: { placedAt: 'desc' },
        take: 1,
        select: { channel: true, governorate: true, fulfillmentMethod: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  }),
  getListOptions('channel', locale),
  getListOptions('governorate', locale),
  getListOptions('fulfillment', locale),
  getListOptions('orderStatus', locale),
  getOrderOperationalDefaults(),
  ]) : [[], [], [], [], [], [], [], await getOrderOperationalDefaults()];

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={(
          <div className="inline-flex items-center gap-2 rounded-lg border border-success/20 bg-success-soft px-3 py-2 text-xs font-semibold text-success">
            <ShieldCheck className="size-4" />
            {t('privacy', { days: config.historyRetentionDays })}
          </div>
        )}
      />
      {available ? (
        <AssistantWorkspace
          locale={locale}
          retentionDays={config.historyRetentionDays}
          initialConversations={rows.map((row) => ({
            id: row.id,
            title: row.title,
            locale: row.locale,
            lastMessageAt: row.lastMessageAt.toISOString(),
            messageCount: row._count.messages,
          }))}
          quickOrder={{
            catalog,
            customers: customers.map((customer) => ({
              externalId: customer.externalId!,
              label: `${locale === 'ar' ? customer.nameAr || customer.nameEn || customer.phone || customer.externalId : customer.nameEn || customer.nameAr || customer.phone || customer.externalId} (${customer.externalId})`,
              phone: customer.phone,
              governorate: customer.governorate,
              recentOrder: customer.orders[0] ?? null,
            })),
            channelOptions: channels,
            governorateOptions: governorates,
            fulfillmentOptions: fulfillment,
            statusOptions: statuses,
            defaults,
          }}
        />
      ) : (
        <Card variant="surface">
          <CardContent className="flex min-h-72 flex-col items-center justify-center text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Bot className="size-5" /></span>
            <h2 className="mt-4 text-lg font-bold text-roast">{t('disabledTitle')}</h2>
            <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">{t('disabledBody')}</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
