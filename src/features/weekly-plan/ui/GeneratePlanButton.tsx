import { Button } from '@shared/ui';
import type { StyleProp, ViewStyle } from 'react-native';
import { useWeeklyPlan } from '../model/useWeeklyPlan';

export interface GeneratePlanButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost';
  style?: StyleProp<ViewStyle>;
}

export function GeneratePlanButton({ variant = 'primary', style }: GeneratePlanButtonProps) {
  const plan = useWeeklyPlan();
  return (
    <Button
      label={plan.isGenerating ? 'Plan hazırlanıyor…' : 'Haftalık planı oluştur'}
      variant={variant}
      loading={plan.isGenerating}
      onPress={plan.generate}
      style={style}
    />
  );
}
