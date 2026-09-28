import { useTheme } from '@shared/ui';
import { Stack } from 'expo-router';

export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primary,
        headerTitleStyle: { color: colors.text },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="check-in" options={{ presentation: 'modal', title: 'Günlük değerlendirme' }} />
      <Stack.Screen name="task/[taskId]" options={{ title: 'Görev' }} />
      <Stack.Screen name="course/[courseId]" options={{ title: 'Ders' }} />
      <Stack.Screen name="courses" options={{ title: 'Dersler' }} />
      <Stack.Screen name="backlog" options={{ title: 'Biriken işler' }} />
      <Stack.Screen name="progress" options={{ title: 'Gidişat' }} />
      <Stack.Screen name="class-schedule" options={{ title: 'Ders programı' }} />
      <Stack.Screen name="review-radar" options={{ title: 'Tekrar radarı' }} />
      <Stack.Screen name="checkin-history" options={{ title: 'Değerlendirmeler' }} />
      <Stack.Screen name="exam/[examId]" options={{ title: 'Sınav modu' }} />
      <Stack.Screen name="weekly-summary" options={{ title: 'Haftalık özet' }} />
    </Stack>
  );
}
