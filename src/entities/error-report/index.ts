export { errorReportRepository } from './data/error-report.repository';
export {
  ERROR_GROUP_STATUS_LABEL,
  groupOrigin,
  groupPlace,
  groupStatus,
  reportFacts,
  stackOf,
  trendLabel,
  type ErrorDigest,
  type ErrorGroup,
  type ErrorGroupDetail,
  type ErrorGroupStatus,
  type ErrorReport,
  type StoredDigest,
} from './domain/error-digest';
export {
  errorReportKeys,
  useErrorGroup,
  useIsAdmin,
  useLiveErrorDigest,
  useSetErrorGroupResolved,
  useStoredErrorDigests,
} from './model/error-report.queries';
