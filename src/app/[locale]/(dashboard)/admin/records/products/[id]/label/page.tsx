import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getPageContext } from '@/server/page-context';
import { getProductLabelData } from '@/server/products/label-data';
import { PageHeader } from '@/components/ui/primitives';
import { BackLink } from '@/components/records/parts';
import { ProductLabelPreview } from '@/components/products/ProductLabelPreview';
import { ProductLabelActions } from '@/components/products/ProductLabelActions';

export default async function ProductLabelPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await getPageContext(params, searchParams, 'manage:products');
  const { id } = await params;
  const t = await getTranslations('records');
  const label = await getProductLabelData(id, locale);
  if (!label) notFound();

  return (
    <>
      <style>{`
        @page { size: 60mm 30mm; margin: 0; }
        @media print {
          body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .sku-label-printable, .sku-label-printable * { visibility: visible !important; }
          .sku-label-printable {
            position: fixed !important;
            inset: 0 auto auto 0 !important;
            width: 60mm !important;
            height: 30mm !important;
            border: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>
      <BackLink href={`/admin/records/products/${id}`} label={t('back')} />
      <PageHeader
        title={t('label.title')}
        subtitle={t('label.subtitle')}
        actions={
          <ProductLabelActions
            pdfHref={`/api/products/${id}/label/pdf?locale=${locale}`}
            printLabel={t('label.print')}
            downloadLabel={t('label.downloadPdf')}
          />
        }
      />
      <div className="rounded-[var(--radius)] border border-border/80 bg-card p-4 shadow-[0_10px_32px_rgba(83,45,31,0.055)]">
        <div className="mx-auto flex max-w-full justify-center overflow-auto rounded-lg bg-linen/35 p-4">
          <div className="shrink-0 shadow-lg shadow-roast/10">
            <ProductLabelPreview label={label} locale={locale} />
          </div>
        </div>
      </div>
    </>
  );
}
