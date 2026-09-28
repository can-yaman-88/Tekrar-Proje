import { isUploadPending, isUploadVisible, type SyllabusUpload } from '../syllabus-upload';

const NOW = Date.parse('2026-09-24T12:00:00Z');

const upload = (over: Partial<SyllabusUpload> = {}): SyllabusUpload => ({
  id: 'u1',
  filename: 'izlence.pdf',
  storagePath: 'user/abc.pdf',
  status: 'succeeded',
  errorMessage: null,
  courseId: 'c1',
  createdAt: '2026-09-24T11:59:00Z',
  ...over,
});

describe('izlence yükleme durum panosu', () => {
  it('süren işler her zaman görünür', () => {
    expect(isUploadPending(upload({ status: 'pending' }))).toBe(true);
    expect(isUploadVisible(upload({ status: 'processing', createdAt: '2026-01-01T00:00:00Z' }), NOW)).toBe(true);
  });

  it('başarısızlar bir gün boyunca görünür, sonra düşer', () => {
    expect(isUploadVisible(upload({ status: 'failed', createdAt: '2026-09-24T09:00:00Z' }), NOW)).toBe(true);
    expect(isUploadVisible(upload({ status: 'failed', createdAt: '2026-09-22T09:00:00Z' }), NOW)).toBe(false);
  });

  it('başarılı yükleme kısa süre sonra panodan düşer', () => {
    expect(isUploadVisible(upload({ createdAt: '2026-09-24T11:59:00Z' }), NOW)).toBe(true); // 1 dk önce
    expect(isUploadVisible(upload({ createdAt: '2026-09-24T11:40:00Z' }), NOW)).toBe(false); // 20 dk önce
  });
});
