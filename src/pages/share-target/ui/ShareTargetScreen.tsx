import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Button, Card, EmptyState, Screen, Skeleton, TextField, makeStyles, useTheme } from '@shared/ui';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { useShareTargetScreen, type ShareTargetController, type TaskChoice } from '../model/useShareTargetScreen';

export function ShareTargetScreen() {
  const vm = useShareTargetScreen();
  const styles = useStyles();

  if (vm.isLoading) {
    return (
      <Screen edges={['bottom']}>
        <View style={styles.content}>
          <Skeleton height={72} radius={12} />
          <Skeleton height={46} radius={10} />
          <Skeleton height={56} radius={10} />
          <Skeleton height={56} radius={10} />
        </View>
      </Screen>
    );
  }

  if (vm.isEmpty) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState
          icon="share-outline"
          title="Eklenecek bir şey yok"
          message={vm.emptyMessage}
          actionLabel="Kapat"
          onAction={vm.onCancel}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']}>
      <FlatList
        data={vm.choices}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={<Header vm={vm} />}
        renderItem={({ item }) => <ChoiceRow choice={item} disabled={vm.isSaving} onPick={vm.onPick} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          vm.tasksError ? (
            <Card style={styles.card}>
              <AppText variant="caption" tone="danger">
                {vm.tasksError}
              </AppText>
              <Button label="Tekrar dene" variant="ghost" onPress={vm.retryTasks} />
            </Card>
          ) : (
            <Card>
              <AppText tone="muted">
                {vm.search
                  ? 'Bu aramaya uyan açık görev yok.'
                  : 'Son iki haftada ve önümüzdeki dört haftada açık görev yok.'}
              </AppText>
            </Card>
          )
        }
        ListFooterComponent={<Button label="Vazgeç" variant="ghost" onPress={vm.onCancel} style={styles.footer} />}
      />
    </Screen>
  );
}

function Header({ vm }: { vm: ShareTargetController }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <Card style={styles.card}>
        <View style={styles.summaryRow}>
          <AppText variant="subtitle" style={styles.flex}>
            {vm.summary}
          </AppText>
          {vm.isSaving ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
        {vm.items.map((item) => (
          <View key={item.key} style={styles.item}>
            <Ionicons name={item.icon} size={16} color={colors.textMuted} />
            <AppText variant="caption" numberOfLines={1} style={styles.flex}>
              {item.label}
            </AppText>
          </View>
        ))}
        {vm.skipped > 0 ? (
          <AppText variant="caption" tone="warning">
            {vm.skipped} öğe eklenmeyecek: yalnızca link, PDF ve fotoğraf (JPEG, PNG, WebP).
          </AppText>
        ) : null}
      </Card>
      <AppText variant="label">Hangi göreve eklensin?</AppText>
      <AppText variant="caption" tone="muted">
        Eklediğin şey o görevin konusunun bütün tekrarlarında da görünür.
      </AppText>
      <TextField
        label="Görev ara"
        value={vm.search}
        onChangeText={vm.onSearch}
        placeholder="Görev, konu ya da ders"
        autoCorrect={false}
        returnKeyType="search"
      />
    </View>
  );
}

function ChoiceRow({
  choice,
  disabled,
  onPick,
}: {
  choice: TaskChoice;
  disabled: boolean;
  onPick: (taskId: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${choice.title}, ${choice.subtitle}`}
      accessibilityHint="Paylaşılanları bu göreve ekler"
      disabled={disabled}
      onPress={() => onPick(choice.id)}
      style={({ pressed }) => [styles.choice, (pressed || disabled) && styles.pressed]}
    >
      <View style={styles.flex}>
        <AppText variant="label" numberOfLines={2}>
          {choice.title}
        </AppText>
        <AppText variant="caption" tone={choice.isOverdue ? 'warning' : 'muted'} numberOfLines={1}>
          {choice.subtitle}
        </AppText>
      </View>
      <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  card: { gap: spacing.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  separator: { height: spacing.xs },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.7 },
  footer: { marginTop: spacing.md },
}));
