import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './clipboard';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('copyToClipboard', () => {
  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyToClipboard('agent handoff')).resolves.toEqual({ method: 'clipboard', ok: true });
    expect(writeText).toHaveBeenCalledWith('agent handoff');
  });

  it('falls back to a textarea copy when navigator.clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    const documentStub = createDocumentStub(true);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', documentStub);

    await expect(copyToClipboard('fallback text')).resolves.toEqual({ method: 'fallback', ok: true });
    expect(documentStub.execCommand).toHaveBeenCalledWith('copy');
    expect(documentStub.lastTextarea?.value).toBe('fallback text');
    expect(documentStub.body.children).toHaveLength(0);
  });

  it('falls back when navigator.clipboard never resolves', async () => {
    const writeText = vi.fn(() => new Promise<void>(() => undefined));
    const documentStub = createDocumentStub(true);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    vi.stubGlobal('document', documentStub);

    await expect(copyToClipboard('timeout text', 1)).resolves.toEqual({ method: 'fallback', ok: true });
    expect(documentStub.execCommand).toHaveBeenCalledWith('copy');
  });

  it('throws a friendly message when no copy path works', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', createDocumentStub(false));

    await expect(copyToClipboard('nope')).rejects.toThrow('Clipboard unavailable. Select the text and copy manually.');
  });
});

function createDocumentStub(execResult: boolean) {
  const body = {
    children: [] as TextareaStub[],
    appendChild(element: TextareaStub) {
      this.children.push(element);
    },
    removeChild(element: TextareaStub) {
      this.children = this.children.filter(child => child !== element);
    },
  };
  const stub = {
    activeElement: null,
    body,
    execCommand: vi.fn(() => execResult),
    lastTextarea: undefined as TextareaStub | undefined,
    createElement: vi.fn(() => {
      const textarea = {
        focus: vi.fn(),
        select: vi.fn(),
        setAttribute: vi.fn(),
        style: {},
        value: '',
      };
      stub.lastTextarea = textarea;
      return textarea;
    }),
  };
  return stub;
}

type TextareaStub = {
  focus: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
  style: Record<string, string>;
  value: string;
};
