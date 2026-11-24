/**
 * Resilient API client for AI Studio / Cloud Run preview environments.
 * Automatically detects sleeping/cold-starting containers (which can return an
 * HTTP 200 HTML wake-up page, HTTP 502/503/504, or a transient "Failed to fetch"),
 * wakes the backend via /api/health, and cleanly retries the request with a fresh body.
 */

export async function waitForServerReady(maxWaitMs = 12000): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('/api/health', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (res.ok && ct.includes('application/json')) {
        const body = await res.json().catch(() => null);
        if (body && body.ok === true) {
          return true;
        }
      }
    } catch {
      // Server still booting — wait and retry
    }
    await new Promise((r) => setTimeout(r, 900));
  }
  return false;
}

export async function readJsonSafe<T = Record<string, any>>(
  res: Response,
  fallbackError = 'Request failed'
): Promise<T> {
  const rawText = await res.text();
  let parsed: any = null;

  if (rawText.trim().length > 0) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
      throw new Error(parsed.error);
    }
    if (res.status === 413) {
      throw new Error('The uploaded file exceeds the 50 MB server limit. Please compress or split the drawing.');
    }
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error(
        `Server was temporarily unavailable (HTTP ${res.status}). Please retry the operation in a moment.`
      );
    }
    throw new Error(`${fallbackError} (HTTP ${res.status}).`);
  }

  if (parsed === null) {
    throw new Error(
      `Received an unexpected non-JSON response from the server (HTTP ${res.status}). Please refresh the page and retry.`
    );
  }

  return parsed as T;
}

export async function fetchJsonWithRetry<T = Record<string, any>>(
  url: string,
  makeInit: () => RequestInit,
  options?: {
    fallbackError?: string;
    maxRetries?: number;
    onStatus?: (message: string) => void;
  }
): Promise<T> {
  const fallbackError = options?.fallbackError || 'Request failed';
  const maxRetries = options?.maxRetries ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const init = makeInit();
      const headers = new Headers(init.headers || {});
      if (!headers.has('Accept')) headers.set('Accept', 'application/json');

      const res = await fetch(url, {
        ...init,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
      });

      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      const rawText = await res.text();
      let parsed: any = null;
      if (rawText.trim().length > 0) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          parsed = null;
        }
      }

      // Transient proxy wake-up / cold-start states:
      // 1) HTTP 502 / 503 / 504 gateway errors
      // 2) HTTP 200 HTML splash/waking page from proxy (non-JSON body)
      const isTransientHtmlWakeup =
        (res.status === 200 || res.status === 502 || res.status === 503 || res.status === 504) &&
        parsed === null &&
        (!contentType.includes('application/json') || rawText.trim().startsWith('<'));

      if (isTransientHtmlWakeup && attempt < maxRetries) {
        options?.onStatus?.('Processing server is waking up — reconnecting automatically...');
        await waitForServerReady(10000);
        await new Promise((r) => setTimeout(r, 400 + attempt * 500));
        continue;
      }

      if (!res.ok) {
        if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
          throw new Error(parsed.error);
        }
        if (res.status === 413) {
          throw new Error('The uploaded file exceeds the 50 MB server limit. Please compress or split the drawing.');
        }
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          throw new Error(
            `Processing server was temporarily restarting (HTTP ${res.status}). Please click upload again.`
          );
        }
        throw new Error(`${fallbackError} (HTTP ${res.status}).`);
      }

      if (parsed === null) {
        throw new Error(
          `Received a non-JSON response from the server (HTTP ${res.status}). Please refresh the preview tab once and retry.`
        );
      }

      return parsed as T;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      lastError = e;
      const isNetworkErr =
        /failed to fetch|networkerror|load failed|network request failed|aborted/i.test(e.message);

      if (isNetworkErr && attempt < maxRetries) {
        options?.onStatus?.('Reconnecting to processing server — retrying automatically...');
        await waitForServerReady(10000);
        await new Promise((r) => setTimeout(r, 500 + attempt * 600));
        continue;
      }
      throw e;
    }
  }

  throw (
    lastError ||
    new Error('Unable to reach the processing server. Please refresh the page and retry the upload.')
  );
}

/** Backwards-compatible helper wrapping fetch with automatic wake-up retry */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  retries = 2,
  retryDelayMs = 1200
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, {
        ...init,
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < retries) {
        await waitForServerReady(8000);
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await waitForServerReady(8000);
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
    }
  }
  const msg = (lastError as Error)?.message || 'Network request failed';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    throw new Error(
      'Unable to reach the processing server. Please refresh the preview tab and retry the upload.'
    );
  }
  throw lastError instanceof Error ? lastError : new Error(msg);
}
