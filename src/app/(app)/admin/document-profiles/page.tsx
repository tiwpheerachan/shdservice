import { Prefetched } from '@/data/db';
import { prefetch } from '@/server/prefetch';
import DocumentProfilesPage from './page-client';

/** the profile list in the HTML: the table never grows in after the first paint (mobile CLS) */
export default async function Page() {
  const fallback = await prefetch(['/api/admin/document-profiles']);
  return (
    <Prefetched fallback={fallback}>
      <DocumentProfilesPage />
    </Prefetched>
  );
}
