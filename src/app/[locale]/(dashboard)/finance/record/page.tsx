import { redirect } from '@/i18n/navigation';

export default async function RecordEntryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect({ href: '/finance/ledger/new', locale });
}
