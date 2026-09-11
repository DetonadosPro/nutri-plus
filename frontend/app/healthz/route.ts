import { APP_BUILD_ID } from '@/lib/app-boot';

export function GET() {
  return Response.json(
    { ok: true, service: 'frontend', buildId: APP_BUILD_ID },
    { headers: { 'cache-control': 'no-store' } },
  );
}
