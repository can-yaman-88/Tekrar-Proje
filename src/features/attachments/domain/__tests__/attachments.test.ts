import { fileTitle, rejectionMessage } from '../drafts';
import { decodeEntities, extractPageTitle } from '../page-title';

describe('extractPageTitle', () => {
  it('prefers the sharing title, in either attribute order', () => {
    expect(extractPageTitle('<title>Ana sayfa</title><meta property="og:title" content="Gauss Yasası">')).toBe(
      'Gauss Yasası',
    );
    expect(extractPageTitle("<meta content='Kapasitörler' property='og:title'/>")).toBe('Kapasitörler');
  });

  it('falls back on <title>, decoded and without the site tacked on', () => {
    expect(extractPageTitle('<title>\n  Elektrik Alan &amp; Potansiyel - YouTube\n</title>')).toBe(
      'Elektrik Alan & Potansiyel',
    );
    expect(extractPageTitle('<title>Ders &#350;emas&#x131;</title>')).toBe('Ders Şeması');
  });

  it('says nothing when the page names nothing', () => {
    expect(extractPageTitle('<html><body>boş</body></html>')).toBeNull();
    expect(extractPageTitle('<title>   </title>')).toBeNull();
  });

  it('leaves unknown entities as they are', () => {
    expect(decodeEntities('a &bogus; b &#0; c')).toBe('a &bogus; b &#0; c');
  });
});

describe('fileTitle', () => {
  const now = new Date(2026, 9, 1, 14, 5);

  it('keeps a name the student or a teacher gave', () => {
    expect(fileTitle('Hafta_3 problemleri.pdf', 'application/pdf', now)).toBe('Hafta 3 problemleri');
    expect(fileTitle('Screenshot 2026-10-01 at 14.05.12.png', 'image/png', now)).toBe(
      'Screenshot 2026-10-01 at 14.05.12',
    );
  });

  it('replaces a camera serial with when it was taken', () => {
    for (const name of ['IMG_20261001_140512.jpg', 'PXL_20261001_140512123.jpg', '1000123.jpg', null]) {
      const title = fileTitle(name, 'image/jpeg', now);
      expect(title.startsWith('Fotoğraf · 1 ')).toBe(true);
      expect(title).toContain('14:05');
    }
    expect(fileTitle(null, 'application/pdf', now).startsWith('Belge · ')).toBe(true);
  });
});

describe('rejectionMessage', () => {
  it('names the first file and counts the rest', () => {
    expect(rejectionMessage([])).toBeNull();
    expect(rejectionMessage([{ name: 'video.mp4', reason: 'unsupported' }])).toBe(
      '"video.mp4" eklenmedi: yalnızca PDF, JPEG, PNG ve WebP eklenebilir.',
    );
    expect(
      rejectionMessage([
        { name: 'kitap.pdf', reason: 'too_big' },
        { name: 'a.heic', reason: 'unsupported' },
      ]),
    ).toBe('"kitap.pdf" eklenmedi: 20 MB sınırını aşıyor. (1 dosya daha eklenmedi.)');
  });
});
