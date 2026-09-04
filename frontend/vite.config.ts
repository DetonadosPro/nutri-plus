import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

// Certificados usados somente no desenvolvimento local.
// Em produção (AWS), o HTTPS será tratado pelo Nginx.
const localCertUrl = new URL(
  './.certs/nutri-local.pem',
  import.meta.url,
);

const localKeyUrl = new URL(
  './.certs/nutri-local-key.pem',
  import.meta.url,
);

const hasLocalHttpsCertificates =
  existsSync(localCertUrl) && existsSync(localKeyUrl);

const localHttps = hasLocalHttpsCertificates
  ? {
      cert: readFileSync(localCertUrl),
      key: readFileSync(localKeyUrl),
    }
  : undefined;

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: {
      postcss: {
        plugins: [tailwindcss()],
      },
    },

    server: {
      host: '0.0.0.0',

      allowedHosts: [
        'desktop-2f3adjr.tail8c5116.ts.net',
      ],

      // Só ativa HTTPS local se os certificados existirem.
      ...(localHttps
        ? {
            https: localHttps,
          }
        : {}),

      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: false,
        },
      },

      ...(isCodexSeatbeltSandbox
        ? {
            watch: {
              useFsEvents: false,
              usePolling: true,
            },
          }
        : {}),
    },

    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: {
          name: 'rsc',
          childEnvironments: ['ssr'],
        },
        config: localBindingConfig,
      }),
    ],
  };
});