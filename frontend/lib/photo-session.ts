export type PhotoDiagnosticValue = string | number | boolean | null;

export type PhotoDiagnosticEntry = {
  timestamp: string;
  sessionId: number | null;
  event: string;
  details: Record<string, PhotoDiagnosticValue>;
  heapBytes: number | null;
};

declare global {
  interface Window {
    __NUTRI_PHOTO_DIAGNOSTICS__?: PhotoDiagnosticEntry[];
  }
}

let nextSessionId = 0;

function debugEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    return (
      new URLSearchParams(window.location.search).get('photoDebug') === '1' ||
      window.localStorage.getItem('nutri:photo-debug') === '1'
    );
  } catch {
    return false;
  }
}

function heapBytes() {
  if (typeof performance === 'undefined') return null;
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    }
  ).memory;
  return Number.isFinite(memory?.usedJSHeapSize)
    ? Number(memory?.usedJSHeapSize)
    : null;
}

export function createPhotoSessionId() {
  nextSessionId += 1;
  return nextSessionId;
}

export function logPhotoSession(
  sessionId: number | null,
  event: string,
  details: Record<string, PhotoDiagnosticValue> = {},
) {
  if (!debugEnabled()) return;
  const entry: PhotoDiagnosticEntry = {
    timestamp: new Date().toISOString(),
    sessionId,
    event,
    details,
    heapBytes: heapBytes(),
  };
  const history = window.__NUTRI_PHOTO_DIAGNOSTICS__ ?? [];
  history.push(entry);
  if (history.length > 250) history.splice(0, history.length - 250);
  window.__NUTRI_PHOTO_DIAGNOSTICS__ = history;
  console.info(
    `[PHOTO_SESSION ${sessionId ?? '-'}] ${event}`,
    JSON.stringify(entry),
  );
}

export function installPhotoLifecycleDiagnostics(
  currentSession: () => number | null,
) {
  if (typeof window === 'undefined' || !debugEnabled()) return () => undefined;
  const log = (event: string, details?: Record<string, PhotoDiagnosticValue>) =>
    logPhotoSession(currentSession(), event, details);
  const visibility = () =>
    log('visibility', { state: document.visibilityState });
  const pageHide = (event: PageTransitionEvent) =>
    log('pagehide', { persisted: event.persisted });
  const pageShow = (event: PageTransitionEvent) =>
    log('pageshow', { persisted: event.persisted });
  const focus = () => log('window focus');
  const blur = () => log('window blur');
  const error = (event: ErrorEvent) =>
    log('window error', {
      name: event.error instanceof Error ? event.error.name : 'Error',
      message: event.message || 'unknown',
    });
  const rejection = (event: PromiseRejectionEvent) =>
    log('unhandled rejection', {
      name: event.reason instanceof Error ? event.reason.name : 'Error',
      message:
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason || 'unknown'),
    });

  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  window.addEventListener('focus', focus);
  window.addEventListener('blur', blur);
  window.addEventListener('error', error);
  window.addEventListener('unhandledrejection', rejection);
  return () => {
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
    window.removeEventListener('focus', focus);
    window.removeEventListener('blur', blur);
    window.removeEventListener('error', error);
    window.removeEventListener('unhandledrejection', rejection);
  };
}

export type PhotoAnalysis = {
  id: number;
  controller: AbortController;
};

export class PhotoAnalysisGate {
  private active: PhotoAnalysis | null = null;
  private disposed = false;

  start(id = createPhotoSessionId()): PhotoAnalysis {
    if (this.disposed) throw new Error('photo-analysis-gate-disposed');
    this.active?.controller.abort();
    const analysis = {
      id,
      controller: new AbortController(),
    };
    this.active = analysis;
    return analysis;
  }

  isCurrent(analysis: PhotoAnalysis) {
    return !this.disposed && this.active === analysis;
  }

  finish(analysis: PhotoAnalysis) {
    if (this.active === analysis) this.active = null;
  }

  cancel() {
    this.active?.controller.abort();
    this.active = null;
  }

  currentSessionId() {
    return this.active?.id ?? null;
  }

  dispose() {
    this.disposed = true;
    this.active?.controller.abort();
    this.active = null;
  }
}

type ObjectUrlApi = Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;

export class PhotoPreviewUrl {
  private value = '';

  constructor(private readonly urlApi: ObjectUrlApi = URL) {}

  replace(blob: Blob) {
    this.clear();
    this.value = this.urlApi.createObjectURL(blob);
    return this.value;
  }

  clear() {
    if (!this.value) return;
    this.urlApi.revokeObjectURL(this.value);
    this.value = '';
  }

  current() {
    return this.value;
  }
}

export function takePhotoInputFile(input: {
  files: FileList | null;
  value: string;
}) {
  const file = input.files?.[0];
  input.value = '';
  return file;
}
