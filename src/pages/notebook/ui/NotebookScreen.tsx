import Ionicons from '@expo/vector-icons/Ionicons';
import { MistakeComposer, MistakeEntry } from '@features/mistake-book';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ProgressBar,
  Screen,
  SegmentedControl,
  Skeleton,
  TextField,
  makeStyles,
  useTheme,
} from '@shared/ui';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import {
  useNotebookScreen,
  type BookFilter,
  type NotebookController,
  type NotebookTab,
  type ReviewRow,
} from '../model/useNotebookScreen';

const MEMORY_TONE = {
  new: 'primary',
  fresh: 'success',
  fading: 'warning',
  due: 'warning',
  overdue: 'warning',
} as const;

export function NotebookScreen() {
  const vm = useNotebookScreen();
  const styles = useStyles();
  const { colors } = useTheme();

  if (vm.error) {
    return (
      <Screen>
        <ErrorState title={vm.error.title} message={vm.error.message} actionLabel="Tekrar dene" onAction={vm.retry} />
      </Screen>
    );
  }

  const dueNow = vm.reviews.counts.late + vm.reviews.counts.today;
  const tabs: { value: NotebookTab; label: string }[] = [
    { value: 'reviews', label: dueNow > 0 ? `Tekrarlar (${dueNow})` : 'Tekrarlar' },
    {
      value: 'mistakes',
      label: vm.mistakes.openCount > 0 ? `Takıldığım yerler (${vm.mistakes.openCount})` : 'Takıldığım yerler',
    },
  ];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={vm.isRefreshing} onRefresh={vm.refresh} tintColor={colors.primary} />
        }
      >
        <View style={styles.headerRow}>
          <AppText variant="display" accessibilityRole="header">
            Defter
          </AppText>
          <Pressable accessibilityRole="button" onPress={vm.onOpenProgress} hitSlop={8}>
            <AppText variant="caption" tone="primary">
              Gidişat ›
            </AppText>
          </Pressable>
        </View>

        <SegmentedControl<NotebookTab> options={tabs} value={vm.tab} onChange={vm.onTab} accessibilityLabel="Defter bölümü" />

        {vm.isLoading ? (
          <View style={styles.section}>
            <Skeleton height={96} radius={16} />
            <Skeleton height={140} radius={16} />
          </View>
        ) : vm.tab === 'reviews' ? (
          <ReviewsTab vm={vm} />
        ) : (
          <MistakesTab vm={vm} />
        )}
      </ScrollView>
    </Screen>
  );
}

function ReviewsTab({ vm }: { vm: NotebookController }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { reviews } = vm;

  return (
    <View style={styles.section}>
      <View style={styles.stats}>
        <Stat value={reviews.counts.late} label="geciken" tone={reviews.counts.late > 0 ? 'warning' : 'muted'} />
        <Stat value={reviews.counts.today} label="bugün" tone={reviews.counts.today > 0 ? 'primary' : 'muted'} />
        <Stat value={reviews.counts.week} label="bu hafta" tone="muted" />
      </View>

      {reviews.notificationPrompt ? (
        <Card style={styles.prompt}>
          <View style={styles.promptRow}>
            <Ionicons name="notifications-outline" size={20} color={colors.primary} />
            <AppText variant="label" style={styles.flex}>
              Tekrar günü gelince haber vereyim mi?
            </AppText>
          </View>
          <AppText variant="caption" tone="muted">
            Görevi zaten listene düşüyor; bildirim, uygulamayı açmadığın günlerde de hatırlatır.
          </AppText>
          <Button
            label="Tekrar bildirimlerini aç"
            variant="secondary"
            loading={reviews.notificationPrompt.busy}
            onPress={reviews.notificationPrompt.onEnable}
          />
        </Card>
      ) : null}

      {reviews.sections.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="Önümüzdeki iki haftada tekrar yok"
          message={
            reviews.studiedTopics === 0
              ? 'Bir görevi bitirdiğinde ya da değerlendirme yazdığında konu tekrar takvimine girer; günü gelince görevi kendiliğinden düşer.'
              : 'Takvimdeki konuların tekrarı daha ileride. Radarda hepsini görebilirsin.'
          }
          actionLabel="Tekrar radarı"
          onAction={reviews.onOpenRadar}
        />
      ) : (
        reviews.sections.map((section) => (
          <View key={section.key} style={styles.section}>
            <View style={styles.headerRow}>
              <AppText variant="label" tone={section.key === 'late' ? 'warning' : 'muted'}>
                {section.title}
              </AppText>
              <AppText variant="caption" tone="muted">
                {section.rows.length}
              </AppText>
            </View>
            {section.rows.map((row) => (
              <ReviewCard key={row.id} row={row} onPress={() => reviews.onOpenTopic(row.id)} />
            ))}
          </View>
        ))
      )}

      {reviews.sections.length > 0 ? (
        <Pressable accessibilityRole="button" onPress={reviews.onOpenRadar} hitSlop={8} style={styles.link}>
          <AppText variant="caption" tone="primary">
            Bütün konular: tekrar radarı ›
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function ReviewCard({ row, onPress }: { row: ReviewRow; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${row.title}, ${row.dueLabel}. Ayrıntı için dokun.`}
      onPress={onPress}
      style={({ pressed }) => [styles.reviewCard, row.isLate && styles.reviewLate, pressed && styles.pressed]}
    >
      <View style={styles.reviewTop}>
        <View style={styles.flex}>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {row.courseLabel}
          </AppText>
          <AppText variant="subtitle" numberOfLines={2}>
            {row.title}
          </AppText>
        </View>
        <View style={styles.dueChip}>
          <AppText variant="caption" tone={row.isLate ? 'warning' : 'primary'}>
            {row.dueLabel}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
      <ProgressBar value={row.elapsed} tone={MEMORY_TONE[row.memory]} height={4} />
      <AppText variant="caption" tone="muted">
        {row.lastLabel}
      </AppText>
      <AppText variant="caption" tone="muted">
        {row.scheduleLabel}
      </AppText>
    </Pressable>
  );
}

const FILTERS: { value: BookFilter; label: string }[] = [
  { value: 'open', label: 'Açık' },
  { value: 'resolved', label: 'Çözülen' },
  { value: 'all', label: 'Hepsi' },
];

function MistakesTab({ vm }: { vm: NotebookController }) {
  const styles = useStyles();
  const { mistakes } = vm;
  const filters = FILTERS.map((option) => ({
    ...option,
    label:
      option.value === 'open'
        ? `Açık (${mistakes.openCount})`
        : option.value === 'resolved'
          ? `Çözülen (${mistakes.resolvedCount})`
          : option.label,
  }));

  return (
    <View style={styles.section}>
      <AppText variant="caption" tone="muted">
        Değerlendirmede takıldığını söylediğin her şey burada, kendi cümlenle. Açık maddeler o konunun görevini açtığında
        karşına çıkar. Basılı tutarak düzenleyebilir ya da silebilirsin.
      </AppText>

      <SegmentedControl<BookFilter>
        options={filters}
        value={mistakes.filter}
        onChange={mistakes.onFilter}
        accessibilityLabel="Defter filtresi"
      />

      <TextField
        label="Defterde ara"
        value={mistakes.search}
        onChangeText={mistakes.onSearch}
        placeholder="Konu, ders ya da kelime"
        autoCorrect={false}
        returnKeyType="search"
      />

      {mistakes.courses.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {mistakes.courses.map((label) => {
            const selected = mistakes.course === label;
            return (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => mistakes.onCourse(label)}
                style={[styles.courseChip, selected && styles.courseChipSelected]}
              >
                <AppText variant="caption" tone={selected ? 'inverse' : 'muted'}>
                  {label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {mistakes.groups.length === 0 ? (
        <EmptyState
          icon="book-outline"
          title={
            mistakes.isFiltered
              ? 'Eşleşen madde yok'
              : mistakes.filter === 'resolved'
                ? 'Çözülen madde yok'
                : mistakes.filter === 'open' && mistakes.resolvedCount > 0
                  ? 'Açık madde kalmadı'
                  : 'Defter boş'
          }
          message={
            mistakes.isFiltered
              ? 'Aramayı ya da ders filtresini değiştir.'
              : mistakes.filter === 'resolved'
                ? 'Bir maddeyi çözdüğünde burada birikir.'
                : 'Değerlendirmede nerede takıldığını yazdıkça buraya işlenir. Bir konunun ekranından elle de ekleyebilirsin.'
          }
          actionLabel={mistakes.isFiltered ? 'Filtreleri temizle' : undefined}
          onAction={mistakes.isFiltered ? mistakes.onClearFilters : undefined}
        />
      ) : (
        mistakes.groups.map((group) => (
          <Card key={group.topicId} style={styles.groupCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${group.topicTitle} konusunun ayrıntısı`}
              onPress={() => mistakes.onOpenTopic(group.topicId)}
              style={styles.groupHeader}
            >
              <View style={styles.flex}>
                <AppText variant="caption" tone="muted">
                  {group.courseLabel}
                </AppText>
                <AppText variant="subtitle">{group.topicTitle}</AppText>
                <AppText variant="caption" tone="muted">
                  {group.summary}
                </AppText>
              </View>
              <AppText variant="caption" tone="primary">
                Konu ›
              </AppText>
            </Pressable>

            {group.entries.map((entry) => (
              <MistakeEntry key={entry.id} entry={entry} actions={mistakes.actions} />
            ))}

            {mistakes.addingTopicId === group.topicId ? (
              <MistakeComposer topicId={group.topicId} actions={mistakes.actions} onDone={mistakes.onStopAdding} />
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => mistakes.onStartAdding(group.topicId)}
                hitSlop={8}
                style={styles.addLink}
              >
                <AppText variant="caption" tone="primary">
                  + Bu konuya madde ekle
                </AppText>
              </Pressable>
            )}
          </Card>
        ))
      )}
    </View>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: 'warning' | 'primary' | 'muted' }) {
  const styles = useStyles();
  return (
    <Card style={styles.stat}>
      <AppText variant="title" tone={tone === 'muted' ? 'default' : tone}>
        {value}
      </AppText>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </Card>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },
  stats: { flexDirection: 'row', gap: spacing.sm },
  stat: { flex: 1, alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.xs, gap: spacing.xxs },
  prompt: { gap: spacing.sm, borderColor: colors.primaryMuted },
  promptRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reviewCard: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  reviewLate: { borderColor: colors.warning },
  reviewTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dueChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  link: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  chips: { gap: spacing.xs, paddingVertical: spacing.xxs },
  courseChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  courseChipSelected: { backgroundColor: colors.primary },
  groupCard: { gap: spacing.xs },
  groupHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingBottom: spacing.xs },
  addLink: { paddingTop: spacing.sm, alignSelf: 'flex-start' },
}));
