import { AppText, makeStyles } from '@shared/ui';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

/**
 * Everything the report understands, by the kind of day it comes from.
 *
 * The report can do what the student does by hand, and more — but a power
 * nobody has heard of is a power nobody uses. A busy student will not guess
 * that "yarın sadece 1 saatim var" reshapes tomorrow; they need to see it once.
 */
const EXAMPLES: readonly { title: string; lines: readonly string[] }[] = [
  {
    title: 'Ne yaptın',
    lines: [
      '“30 kafes sorusundan 24’ü doğru”',
      '“Carnot’ta takıldım ama kitaba bakınca çözdüm”',
      '“dün Gauss’a 40 dakika harcadım”',
    ],
  },
  {
    title: 'Hepsi birden',
    lines: ['“bugünkü her şeyi bitirdim”', '“Gauss hariç hepsini yaptım”', '“bugün hiç çalışamadım”'],
  },
  {
    title: 'Plan dışı',
    lines: ['“plan dışı 15 türev sorusu çözdüm, 12 doğru”', '“fazladan bir saat kinematik tekrar ettim”'],
  },
  {
    title: 'Günlerin',
    lines: [
      '“yarın sadece 1 saatim var”',
      '“önümüzdeki 3 gün çok yoğunum, hafiflet”',
      '“cumadan pazartesiye kadar yokum”',
      '“pazarları artık çalışabiliyorum”',
    ],
  },
  {
    title: 'Düzen ve gruplar',
    lines: [
      '“konsept ve feynmanı grupla”',
      '“grupları dağıt”',
      '“salı ile perşembenin görevlerini değiştir”',
      '“görevleri konu sırasına göre diz, günlerdeki sayı aynı kalsın”',
      '“haftayı düzenle”',
      '“geciken işleri önümüzdeki günlere dağıt”',
      '“tüm görevleri İngilizce yap”',
    ],
  },
  {
    title: 'Dersler ve sınavlar',
    lines: [
      '“bu hafta kimyayı dondur”',
      '“yarın sadece fiziğe çalışacağım”',
      '“fizik vizesi için plan çıkar”',
      '“vizeden 65 aldım, Gauss’ta zorlandım”',
      '“vize 1 ilk beş haftayı kapsıyor”',
    ],
  },
  {
    title: 'Yeni iş',
    lines: [
      '“İngilizce ödevi yarın gece 12’ye kadar”',
      '“yarın 20 türev sorusu çözeceğim”',
      '“fizik ödevini üç adıma böl”',
    ],
  },
  {
    title: 'Düzeltme',
    lines: [
      '“fizik ödevi 25 soruymuş”',
      '“bunu cumaya al”',
      '“vize 5 Aralık’a ertelendi”',
      '“geçen takıldığım bağıl hız meselesi oturdu”',
      '“fizik ödevi acil”',
      '“az önceki değerlendirmeyi geri al”',
    ],
  },
  {
    title: 'Hatırlat',
    lines: ['“yarın 9’da fizik ödevini hatırlat”', '“cuma akşamı quizi hatırlat”'],
  },
  {
    title: 'Sor',
    lines: ['“yarın ne var?”', '“hangi ödevlerin teslimi yakın?”', '“nerelerde zayıfım?”'],
  },
];

export function CheckinExamples() {
  const styles = useStyles();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <AppText variant="label">Neler yazabilirim?</AppText>
        <AppText variant="caption" tone="muted">
          {open ? 'Gizle' : 'Göster'}
        </AppText>
      </Pressable>
      {open
        ? EXAMPLES.map((group) => (
            <View key={group.title} style={styles.group}>
              <AppText variant="caption">{group.title}</AppText>
              <AppText variant="caption" tone="muted">
                {group.lines.join(' · ')}
              </AppText>
            </View>
          ))
        : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors, radii, spacing }) => ({
  box: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  group: { gap: spacing.xxs },
  pressed: { opacity: 0.7 },
}));
