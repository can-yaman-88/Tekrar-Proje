import { toAppError } from './AppError';

export interface ErrorDescription {
  title: string;
  message: string;
  canRetry: boolean;
}

/** Human copy for any thrown value. */
export function describeError(error: unknown): ErrorDescription {
  const appError = toAppError(error);
  switch (appError.kind) {
    case 'network':
      return { title: 'Çevrimdışısın', message: 'Kayıtlı veriler gösteriliyor. Bağlanınca aşağı çekip yenile.', canRetry: true };
    case 'unauthorized':
      return { title: 'Oturum süresi doldu', message: 'Lütfen tekrar giriş yap.', canRetry: false };
    case 'rate_limited':
      return { title: 'Çok hızlısın', message: 'Çok fazla istek gönderildi. Birazdan tekrar dene.', canRetry: true };
    case 'server':
      return { title: 'Sunucu hatası', message: appError.message, canRetry: true };
    default:
      return { title: 'Bir şeyler ters gitti', message: appError.message, canRetry: appError.retryable };
  }
}
