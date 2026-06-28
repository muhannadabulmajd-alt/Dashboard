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
          html,
          body {
            width: 60mm !important;
            height: 30mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            background: #fff !important;
          }
          .app-surface {
            display: block !important;
            width: 60mm !important;
            min-height: 30mm !important;
            overflow: hidden !important;
            background: #fff !important;
          }
          .app-surface > aside,
          .app-surface > div > :not(main),
          main > :not(.sku-label-print-page) {
            display: none !important;
          }
          .app-surface > div,
          main,
          .sku-label-print-page,
          .sku-label-print-shell,
          .sku-label-print-inner {
            display: block !important;
            width: 60mm !important;
            height: 30mm !important;
            min-height: 30mm !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            overflow: hidden !important;
            background: #fff !important;
          }
          .sku-label-printable {
            position: static !important;
            width: 60mm !important;
            height: 30mm !important;
            margin: 0 !important;
            border: 0 !important;
            box-shadow: none !important;
            break-after: avoid !important;
            break-before: avoid !important;
            break-inside: avoid !important;
            page-break-after: avoid !important;
            page-break-before: avoid !important;
            page-break-inside: avoid !important;
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
          }
          .sku-label-printable svg,
          .sku-label-printable rect {
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
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
      <div className="sku-label-print-page rounded-[var(--radius)] border border-border/80 bg-card p-4 shadow-[0_10px_32px_rgba(83,45,31,0.055)]">
        <div className="sku-label-print-shell mx-auto flex max-w-full justify-center overflow-auto rounded-lg bg-linen/35 p-4">
          <div className="sku-label-print-inner shrink-0 shadow-lg shadow-roast/10">
            <ProductLabelPreview label={label} locale={locale} />
          </div>
        </div>
      </div>
    </>
  );
}
