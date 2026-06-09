import { redirect } from 'next/navigation';

/**
 * Product groups are now managed inside the unified "Products & Variations"
 * section (BRD §3). Keep this route working for old links by redirecting to the
 * main-products view.
 */
export default async function ProductGroupsRedirect({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/admin/records/products?view=main`);
}
