import {
  acceptedMime,
  cleanTitle,
  defaultLinkTitle,
  describeAttachment,
  firstUrlIn,
  formatBytes,
  normalizeUrl,
  sectionsOf,
  siteName,
  storagePathFor,
  titleFromFilename,
  type Attachment,
} from '../attachment';

const attachment = (over: Partial<Attachment>): Attachment => ({
  id: 'a',
  kind: 'file',
  title: 'Slaytlar',
  url: null,
  bucket: 'attachments',
  storagePath: 'u/a.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2_516_582,
  createdAt: '2026-10-01T10:00:00.000Z',
  relation: 'task',
  taskId: 't',
  taskTitle: 'Hafta 3',
  editable: true,
  isPending: false,
  localUri: null,
  ...over,
});

describe('acceptedMime', () => {
  it('takes the four kinds the bucket stores, and nothing else', () => {
    expect(acceptedMime('application/pdf')).toBe('application/pdf');
    expect(acceptedMime('image/jpg')).toBe('image/jpeg');
    expect(acceptedMime('IMAGE/PNG; charset=binary')).toBe('image/png');
    expect(acceptedMime('image/heic', 'IMG_1.heic')).toBeNull();
    expect(acceptedMime('video/mp4')).toBeNull();
  });

  it('falls back on the file name when the picker knows nothing', () => {
    expect(acceptedMime(null, 'Hafta 3.PDF')).toBe('application/pdf');
    expect(acceptedMime('application/octet-stream', 'tahta.webp')).toBe('image/webp');
    expect(acceptedMime('', 'notlar.docx')).toBeNull();
  });
});

describe('normalizeUrl', () => {
  it('adds the scheme a pasted address often lacks', () => {
    expect(normalizeUrl('youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(normalizeUrl('  HTTPS://Example.com/a?b=1#c ')).toBe('https://Example.com/a?b=1#c');
  });

  it('refuses what the database would refuse', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('ftp://example.com/x')).toBeNull();
    expect(normalizeUrl('not a link')).toBeNull();
    expect(normalizeUrl('localhostish')).toBeNull();
    expect(normalizeUrl(`https://example.com/${'a'.repeat(2048)}`)).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
});

describe('firstUrlIn', () => {
  it('finds the address in shared text and leaves the sentence behind', () => {
    expect(firstUrlIn('Şuna bak: https://www.youtube.com/watch?v=x1. Çok iyi')).toBe(
      'https://www.youtube.com/watch?v=x1',
    );
    expect(firstUrlIn('(https://tr.wikipedia.org/wiki/Gauss_yasası)')).toBe(
      'https://tr.wikipedia.org/wiki/Gauss_yasası',
    );
    expect(firstUrlIn('yarın sınav var')).toBeNull();
  });
});

describe('link names', () => {
  it('names well-known sites and strips www elsewhere', () => {
    expect(siteName('https://m.youtube.com/watch?v=1')).toBe('YouTube');
    expect(siteName('https://youtu.be/1')).toBe('YouTube');
    expect(siteName('https://www.fizik.edu.tr/notlar')).toBe('fizik.edu.tr');
  });

  it('builds a readable default from the site and the last path segment', () => {
    expect(defaultLinkTitle('https://tr.wikipedia.org/wiki/Gauss_yasas%C4%B1')).toBe('Vikipedi · Gauss yasası');
    expect(defaultLinkTitle('https://www.fizik.edu.tr/')).toBe('fizik.edu.tr');
  });
});

describe('titles and sizes', () => {
  it('turns a file name into a title', () => {
    expect(titleFromFilename('Hafta_3-slaytlar.pdf')).toBe('Hafta 3-slaytlar');
    expect(titleFromFilename('/cache/x/.pdf')).toBe('Dosya');
    expect(cleanTitle(`  a\n\tb  ${'c'.repeat(300)}`)).toHaveLength(200);
  });

  it('formats sizes the Turkish way', () => {
    expect(formatBytes(840 * 1024)).toBe('840 KB');
    expect(formatBytes(2_516_582)).toBe('2,4 MB');
    expect(formatBytes(null)).toBe('');
  });

  it('describes a row by kind, size or site', () => {
    expect(describeAttachment(attachment({}))).toBe('PDF · 2,4 MB');
    expect(describeAttachment(attachment({ mimeType: 'image/jpeg', sizeBytes: 2048 }))).toBe('Görsel · 2 KB');
    expect(describeAttachment(attachment({ kind: 'link', url: 'https://youtu.be/x', mimeType: null }))).toBe('YouTube');
  });

  it('files objects under the student, named by the row', () => {
    expect(storagePathFor('user-1', 'att-1', 'image/jpeg')).toBe('user-1/att-1.jpg');
  });
});

describe('sectionsOf', () => {
  it('lists the nearest material first, newest first within', () => {
    const sections = sectionsOf([
      attachment({ id: 'topic-old', relation: 'topic', createdAt: '2026-09-01T00:00:00.000Z' }),
      attachment({ id: 'own', relation: 'task' }),
      attachment({ id: 'topic-new', relation: 'topic', createdAt: '2026-09-20T00:00:00.000Z' }),
      attachment({ id: 'sheet', relation: 'source' }),
    ]);
    expect(sections.map((section) => section.relation)).toEqual(['task', 'source', 'topic']);
    expect(sections[2]?.items.map((item) => item.id)).toEqual(['topic-new', 'topic-old']);
    expect(sections[0]?.title).toBe('Bu görevin ekleri');
  });
});
