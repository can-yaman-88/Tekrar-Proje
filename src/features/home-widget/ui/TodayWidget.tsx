import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { CHECK_IN_URI, COMPLETE_ACTION, taskUri, type WidgetRow, type WidgetView } from '../domain/widget-view';

type HexColor = `#${string}`;

/** The app's own colours (shared/ui/theme/tokens), fixed here: a widget has no theme provider. */
export interface WidgetPalette {
  background: HexColor;
  surfaceMuted: HexColor;
  border: HexColor;
  text: HexColor;
  textMuted: HexColor;
  primary: HexColor;
  primaryMuted: HexColor;
  onPrimary: HexColor;
  warning: HexColor;
  danger: HexColor;
}

export const LIGHT_PALETTE: WidgetPalette = {
  background: '#FFFFFF',
  surfaceMuted: '#EEF0F3',
  border: '#E1E4E8',
  text: '#14171C',
  textMuted: '#5F6773',
  primary: '#3451D1',
  primaryMuted: '#E6EBFC',
  onPrimary: '#FFFFFF',
  warning: '#B26B00',
  danger: '#C8372D',
};

export const DARK_PALETTE: WidgetPalette = {
  background: '#161A21',
  surfaceMuted: '#1F242D',
  border: '#2A303B',
  text: '#ECEFF3',
  textMuted: '#9AA3AF',
  primary: '#7F98FF',
  primaryMuted: '#1E2748',
  onPrimary: '#0E1116',
  warning: '#F0AE45',
  danger: '#FF7A6E',
};

const ROOT_STYLE = (p: WidgetPalette) =>
  ({
    height: 'match_parent',
    width: 'match_parent',
    flexDirection: 'column',
    backgroundColor: p.background,
    borderRadius: 16,
    padding: 12,
  }) as const;

function Message({ palette, title, body }: { palette: WidgetPalette; title: string; body: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      accessibilityLabel={`${title}. ${body}`}
      style={{ ...ROOT_STYLE(palette), justifyContent: 'center' }}
    >
      <TextWidget text={title} style={{ fontSize: 15, fontWeight: '600', color: palette.text }} />
      <TextWidget text={body} maxLines={2} style={{ fontSize: 12, color: palette.textMuted, marginTop: 4 }} />
    </FlexWidget>
  );
}

function Row({ row, palette }: { row: WidgetRow; palette: WidgetPalette }) {
  const badgeColor = row.isOverdue ? palette.warning : row.isUrgent ? palette.danger : palette.textMuted;
  return (
    <FlexWidget style={{ width: 'match_parent', height: 34, flexDirection: 'row', alignItems: 'center' }}>
      {/* The circle ticks; work that needs a rating or scores opens instead. */}
      <FlexWidget
        clickAction={row.needsApp ? 'OPEN_URI' : COMPLETE_ACTION}
        clickActionData={row.needsApp ? { uri: taskUri(row.id) } : { taskId: row.id }}
        accessibilityLabel={row.needsApp ? `${row.title} — aç` : `${row.title} — tamamla`}
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          borderWidth: 2,
          borderColor: row.needsApp ? palette.primary : palette.border,
          backgroundColor: row.needsApp ? palette.primaryMuted : palette.background,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <TextWidget text={row.needsApp ? '›' : ' '} style={{ fontSize: 14, fontWeight: '700', color: palette.primary }} />
      </FlexWidget>
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: taskUri(row.id) }}
        accessibilityLabel={`${row.title}, ${row.context}`}
        style={{ flex: 1, height: 'match_parent', flexDirection: 'column', justifyContent: 'center', marginLeft: 10 }}
      >
        <TextWidget text={row.title} maxLines={1} truncate="END" style={{ fontSize: 13, fontWeight: '600', color: palette.text }} />
        <TextWidget text={row.context} maxLines={1} truncate="END" style={{ fontSize: 11, color: palette.textMuted }} />
      </FlexWidget>
      {row.badge ? (
        <TextWidget text={row.badge} style={{ fontSize: 11, fontWeight: '600', color: badgeColor, marginLeft: 8 }} />
      ) : null}
    </FlexWidget>
  );
}

/** "Bugün" on the home screen: what is left, what is due for review, one tap to the evening report. */
export function TodayWidget({ view, palette }: { view: WidgetView; palette: WidgetPalette }) {
  if (view.kind === 'signedOut') {
    return <Message palette={palette} title="Tekrar" body="Bugünün işlerini burada görmek için uygulamada giriş yap." />;
  }
  if (view.kind === 'stale') {
    return <Message palette={palette} title="Tekrar" body="Planını güncellemek için uygulamayı bir kez aç." />;
  }

  return (
    <FlexWidget style={ROOT_STYLE(palette)}>
      <FlexWidget
        clickAction="OPEN_APP"
        accessibilityLabel={`Tekrar, ${view.title}${view.progress ? `, ${view.progress} bitti` : ''}`}
        style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}
      >
        <TextWidget text="Bugün" style={{ fontSize: 15, fontWeight: '700', color: palette.text }} />
        <TextWidget
          text={view.title}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 12, color: palette.textMuted, marginLeft: 8 }}
        />
        <FlexWidget style={{ flex: 1 }} />
        {view.progress ? (
          <FlexWidget
            style={{ backgroundColor: palette.primaryMuted, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}
          >
            <TextWidget text={view.progress} style={{ fontSize: 12, fontWeight: '700', color: palette.primary }} />
          </FlexWidget>
        ) : null}
      </FlexWidget>

      <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'column' }}>
        {view.rows.map((row) => (
          <Row key={row.id} row={row} palette={palette} />
        ))}
        {view.empty ? (
          <TextWidget text={view.empty} style={{ fontSize: 13, color: palette.textMuted, marginTop: 6 }} />
        ) : null}
        {view.more ? (
          <TextWidget
            text={view.more}
            clickAction="OPEN_APP"
            style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}
          />
        ) : null}
      </FlexWidget>

      {view.notice ? (
        <TextWidget text={view.notice} maxLines={1} truncate="END" style={{ fontSize: 11, color: palette.danger }} />
      ) : null}
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: 'tekrar://notebook' }}
          accessibilityLabel={view.reviews ?? 'Defter'}
          style={{ flex: 1 }}
        >
          <TextWidget
            text={view.reviews ?? ' '}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 11, color: palette.textMuted }}
          />
        </FlexWidget>
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: CHECK_IN_URI }}
          accessibilityLabel="Günlük değerlendirme yaz"
          style={{ backgroundColor: palette.primary, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}
        >
          <TextWidget text="Değerlendirme" style={{ fontSize: 12, fontWeight: '600', color: palette.onPrimary }} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
