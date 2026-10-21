import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => ({ binary: vi.fn(async () => ({})), openxml: vi.fn(async () => ({})) }));
vi.mock('../packages/renderers/word/src/wordDoc', () => ({ default: handlers.binary }));
vi.mock('../packages/renderers/word/src/wordDocx', () => ({ default: handlers.openxml }));

import { renderFileViewerWordDocx, wordRenderer } from '../packages/renderers/word/src/index';

beforeEach(() => vi.clearAllMocks());

describe('Word content dispatch for mislabeled DOCX', () => {
  const target = {} as HTMLDivElement;
  const binary = () => Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).buffer;

  it('routes the registered OpenXML handler through the existing binary sniffer', async () => {
    const buffer = binary();
    const handler = wordRenderer.handlers.find(row => row.rendererId === 'office-word-openxml')!.handler;
    await handler(buffer, target, 'docx', undefined);
    expect(handlers.binary).toHaveBeenCalledWith(buffer, target, undefined);
    expect(handlers.openxml).not.toHaveBeenCalled();
  });

  it('gives direct handler consumers the same content-based dispatch', async () => {
    await renderFileViewerWordDocx(binary(), target, 'docx', undefined);
    expect(handlers.binary).toHaveBeenCalledOnce();
  });

  it('keeps genuine OOXML on the unchanged OpenXML parser', async () => {
    const buffer = Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0]).buffer;
    await renderFileViewerWordDocx(buffer, target, 'docx', undefined);
    expect(handlers.openxml).toHaveBeenCalledWith(buffer, target, undefined);
    expect(handlers.binary).not.toHaveBeenCalled();
  });
});
