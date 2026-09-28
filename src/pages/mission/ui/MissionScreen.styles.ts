import { makeStyles } from '@shared/ui';

export const useMissionStyles = makeStyles(({ colors, radii, spacing }) => ({
  skeletonContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  skeletonHeader: { gap: spacing.sm, paddingTop: spacing.lg, marginBottom: spacing.lg },
  skeletonExams: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  errorWrap: { flex: 1, justifyContent: 'center' },
  catchUpBanner: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.primaryMuted,
  },
  pressed: { opacity: 0.7 },
  offlineBanner: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  staleBanner: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.warningMuted,
  },
  // A deadline that will not fit is a warning about the plan, not about the
  // app, so it shares the warning colour but keeps its own row.
  pressureBanner: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.warningMuted,
    gap: spacing.xs,
  },
  pressureHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pressureDismiss: { alignSelf: 'flex-start' },
  empty: { marginTop: spacing.xl },
  emptyAction: { marginHorizontal: spacing.lg },
}));
