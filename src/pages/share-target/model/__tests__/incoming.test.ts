import { describeIncoming, readIncoming, type ResolvedIncomingPayload } from '../incoming';

const resolved = (over: Partial<ResolvedIncomingPayload>): ResolvedIncomingPayload => ({
  value: 'content://x',
  shareType: 'image',
  mimeType: 'image/jpeg',
  contentUri: 'file:///cache/x.jpg',
  contentType: 'image',
  contentMimeType: 'image/jpeg',
  originalName: 'x.jpg',
  contentSize: 1000,
  ...over,
});

describe('readIncoming', () => {
  it('takes the address out of shared text, once', () => {
    const share = readIncoming(
      [
        { value: 'Bunu izle https://youtu.be/abc', shareType: 'text' },
        { value: 'https://youtu.be/abc', shareType: 'url' },
      ],
      [],
    );
    expect(share.links).toEqual(['https://youtu.be/abc']);
    expect(share.hasTextWithoutLink).toBe(false);
  });

  it('notices text that holds no link', () => {
    expect(readIncoming([{ value: 'yarın quiz var', shareType: 'text' }], []).hasTextWithoutLink).toBe(true);
  });

  it('keeps PDFs and photos, counts the rest as skipped', () => {
    const share = readIncoming(
      [],
      [
        resolved({}),
        resolved({ shareType: 'file', contentMimeType: 'application/pdf', originalName: 'odev.pdf' }),
        resolved({ shareType: 'video', contentMimeType: 'video/mp4', originalName: 'ders.mp4' }),
        resolved({ shareType: 'file', contentMimeType: null, mimeType: undefined, originalName: 'notlar.docx' }),
        resolved({ contentUri: null }),
      ],
    );
    expect(share.files.map((file) => file.name)).toEqual(['x.jpg', 'odev.pdf']);
    expect(share.unsupported).toBe(2);
    expect(describeIncoming(share)).toBe('1 fotoğraf · 1 PDF');
  });

  it('summarises a mixed share', () => {
    const share = readIncoming([{ value: 'https://example.com/a', shareType: 'url' }], [resolved({})]);
    expect(describeIncoming(share)).toBe('1 link · 1 fotoğraf');
  });
});
