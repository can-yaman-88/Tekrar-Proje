import { EmptyState, Screen } from '@shared/ui';
import { useRouter } from 'expo-router';

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen>
      <EmptyState
        icon="compass-outline"
        title="Sayfa bulunamadı"
        actionLabel="Görevlere dön"
        onAction={() => router.replace('/')}
      />
    </Screen>
  );
}
