declare const __NUTRI_BUILD_ID__: string;

export const APP_BUILD_ID =
  typeof __NUTRI_BUILD_ID__ === 'string' && __NUTRI_BUILD_ID__.trim()
    ? __NUTRI_BUILD_ID__
    : 'development';

export type BootStage =
  | 'html-loaded'
  | 'dom-ready'
  | 'bundle-start'
  | 'react-entry'
  | 'providers-mounted'
  | 'session-check-start'
  | 'session-check-complete'
  | 'first-ui-rendered'
  | 'asset-error'
  | 'js-error'
  | 'unhandled-rejection'
  | 'boot-timeout'
  | 'chunk-recovery'
  | 'boot-error';

export type BootDiagnostic = {
  stage: BootStage;
  elapsedMs: number;
  buildId: string;
  detail?: string;
};

declare global {
  interface Window {
    __NUTRI_BOOT_STARTED_AT__?: number;
    __NUTRI_BOOT_DIAGNOSTICS__?: BootDiagnostic[];
    __NUTRI_MARK_BOOT__?: (stage: BootStage, detail?: string) => void;
  }
}

const FAILURE_STAGES = new Set<BootStage>([
  'asset-error',
  'js-error',
  'unhandled-rejection',
  'boot-timeout',
  'chunk-recovery',
  'boot-error',
]);

function safeDetail(value: unknown) {
  const detail =
    value instanceof Error
      ? value.message
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : value == null
          ? ''
          : 'unknown-error';
  return detail.replace(/[\r\n]+/g, ' ').slice(0, 180);
}

function deviceKind() {
  if (typeof navigator === 'undefined') return 'unknown';
  return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
}

function reportBoot(diagnostic: BootDiagnostic) {
  if (typeof navigator === 'undefined' || typeof Blob === 'undefined') return;
  try {
    const payload = JSON.stringify({
      ...diagnostic,
      detail: diagnostic.detail || undefined,
      device: deviceKind(),
      online: navigator.onLine,
    });
    navigator.sendBeacon?.('/api/client-boot', new Blob([payload], { type: 'application/json' }));
  } catch {
    // Boot telemetry must never interfere with rendering or recovery.
  }
}

export function markBoot(stage: BootStage, detail?: unknown) {
  if (typeof window === 'undefined') return;
  if (window.__NUTRI_MARK_BOOT__) {
    window.__NUTRI_MARK_BOOT__(stage, safeDetail(detail));
    return;
  }
  const startedAt = window.__NUTRI_BOOT_STARTED_AT__ ?? Date.now();
  window.__NUTRI_BOOT_STARTED_AT__ = startedAt;
  const diagnostic: BootDiagnostic = {
    stage,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    buildId: APP_BUILD_ID,
    ...(detail ? { detail: safeDetail(detail) } : {}),
  };
  const history = window.__NUTRI_BOOT_DIAGNOSTICS__ ?? [];
  history.push(diagnostic);
  window.__NUTRI_BOOT_DIAGNOSTICS__ = history.slice(-30);
  console.info(`[nutri-boot] ${stage}; build=${APP_BUILD_ID}; ms=${diagnostic.elapsedMs}`);
  if (stage === 'first-ui-rendered' || FAILURE_STAGES.has(stage)) reportBoot(diagnostic);
}

export function isChunkLoadError(error: unknown) {
  const message = safeDetail(error);
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

export function recoveryUrl(currentUrl: string, targetBuild: string) {
  const url = new URL(currentUrl);
  url.searchParams.set('app-recovery', targetBuild.slice(0, 24));
  return url.toString();
}

export async function attemptChunkRecovery(error: unknown) {
  if (typeof window === 'undefined' || !isChunkLoadError(error)) return false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`/api/health?boot=${encodeURIComponent(APP_BUILD_ID)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const current = (await response.json()) as { version?: string };
    if (!response.ok || !current.version || current.version === APP_BUILD_ID) return false;
    const key = `nutri:boot-recovery:${current.version}`;
    try {
      if (sessionStorage.getItem(key) === '1') return false;
      sessionStorage.setItem(key, '1');
    } catch {
      return false;
    }
    markBoot('chunk-recovery', `${APP_BUILD_ID}->${current.version}`);
    window.location.replace(recoveryUrl(window.location.href, current.version));
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function bootGuardScript(buildId: string, timeoutMs = 12_000) {
  const safeBuild = JSON.stringify(buildId);
  return `(()=>{var w=window,d=document,build=${safeBuild},started=Date.now(),history=[];w.__NUTRI_BOOT_STARTED_AT__=started;w.__NUTRI_BOOT_DIAGNOSTICS__=history;var clean=function(v){return String(v||'').replace(/[\\r\\n]+/g,' ').slice(0,180)};var device=function(){return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)?'mobile':'desktop'};var report=function(entry){try{var body=JSON.stringify(Object.assign({},entry,{device:device(),online:navigator.onLine}));navigator.sendBeacon&&navigator.sendBeacon('/api/client-boot',new Blob([body],{type:'application/json'}))}catch(_){}};var mark=function(stage,detail){var entry={stage:stage,elapsedMs:Math.max(0,Date.now()-started),buildId:build};if(detail)entry.detail=clean(detail);history.push(entry);if(history.length>30)history.shift();console.info('[nutri-boot] '+stage+'; build='+build+'; ms='+entry.elapsedMs);if(stage==='first-ui-rendered'||/^(asset-error|js-error|unhandled-rejection|boot-timeout|chunk-recovery|boot-error)$/.test(stage))report(entry)};w.__NUTRI_MARK_BOOT__=mark;var fallback=function(reason){if(d.querySelector('[data-nutri-first-ui=true]')||d.getElementById('nutri-boot-fallback'))return;mark('boot-timeout',reason);var box=d.createElement('main');box.id='nutri-boot-fallback';box.setAttribute('data-nutri-first-ui','true');box.style.cssText='position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:#f5f2ea;color:#173e31;font:16px system-ui,sans-serif';box.innerHTML='<section style="max-width:520px;padding:28px;border:1px solid #dbe6df;border-radius:22px;background:white;box-shadow:0 16px 50px rgba(20,60,45,.12);text-align:center"><h1 style="margin:0 0 12px;font-size:24px">Não foi possível iniciar o Nutri+.</h1><p style="margin:0 0 20px;line-height:1.5;color:#52665e">A página demorou além do esperado ou um arquivo do aplicativo não carregou.</p><button id="nutri-boot-retry" style="padding:12px 18px;border:0;border-radius:12px;background:#176b50;color:white;font-weight:700;cursor:pointer">Tentar novamente</button><p style="margin:16px 0 0;font-size:12px;color:#75847e">Código: BOOT-'+clean(reason).replace(/[^a-z0-9_-]/gi,'').slice(0,28)+'</p></section>';(d.body||d.documentElement).appendChild(box);d.getElementById('nutri-boot-retry').addEventListener('click',function(){var u=new URL(location.href);u.searchParams.set('app-retry',Date.now().toString(36));location.replace(u.toString())})};var recover=function(reason){var controller=new AbortController(),timer=setTimeout(function(){controller.abort()},4000);fetch('/api/health?boot='+encodeURIComponent(build),{cache:'no-store',credentials:'same-origin',signal:controller.signal}).then(function(r){return r.ok?r.json():Promise.reject()}).then(function(data){if(!data.version||data.version===build)throw new Error('same-build');var key='nutri:boot-recovery:'+data.version;try{if(sessionStorage.getItem(key)==='1')throw new Error('already-tried');sessionStorage.setItem(key,'1')}catch(_){fallback(reason);return}mark('chunk-recovery',build+'->'+data.version);var u=new URL(location.href);u.searchParams.set('app-recovery',String(data.version).slice(0,24));location.replace(u.toString())}).catch(function(){fallback(reason)}).finally(function(){clearTimeout(timer)})};mark('html-loaded');d.addEventListener('DOMContentLoaded',function(){mark('dom-ready')},{once:true});w.addEventListener('error',function(event){var target=event.target;if(target&&target!==w&&(target.tagName==='SCRIPT'||target.tagName==='LINK')){var asset=target.src||target.href||target.tagName;mark('asset-error',asset);recover('asset-error');return}mark('js-error',event.message||'window-error');setTimeout(function(){fallback('js-error')},0)},true);w.addEventListener('unhandledrejection',function(event){mark('unhandled-rejection',event.reason);setTimeout(function(){fallback('promise-rejection')},0)});setTimeout(function(){fallback('watchdog')},${Math.max(1_000, timeoutMs)});})();`;
}
