export interface ClipboardCopyResult {
  method: 'clipboard' | 'fallback';
  ok: true;
}

const defaultTimeoutMs = 800;

export async function copyToClipboard(text: string, timeoutMs = defaultTimeoutMs): Promise<ClipboardCopyResult> {
  const writeText = globalThis.navigator?.clipboard?.writeText;
  if (typeof writeText === 'function') {
    try {
      await withTimeout(writeText.call(globalThis.navigator.clipboard, text), timeoutMs);
      return { method: 'clipboard', ok: true };
    } catch {
      if (fallbackCopy(text)) return { method: 'fallback', ok: true };
      throw new Error('Clipboard copy failed. Select the text and copy manually.');
    }
  }
  if (fallbackCopy(text)) return { method: 'fallback', ok: true };
  throw new Error('Clipboard unavailable. Select the text and copy manually.');
}

async function withTimeout(promise: Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Clipboard write timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fallbackCopy(text: string): boolean {
  const doc = globalThis.document;
  if (!doc?.body || typeof doc.createElement !== 'function' || typeof doc.execCommand !== 'function') return false;
  const textarea = doc.createElement('textarea');
  const activeElement = typeof HTMLElement === 'function' && doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  doc.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    return doc.execCommand('copy');
  } finally {
    doc.body.removeChild(textarea);
    activeElement?.focus();
  }
}
