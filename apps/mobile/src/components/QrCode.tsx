import qrcode from 'qrcode-generator';
import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

/**
 * QR code drawn with react-native-svg from a pure-JS encoder (no native module).
 * Always dark-on-white so wallets and authenticator apps can scan it in either theme.
 */
export const QrCode = memo(function QrCode({ value, size = 176, label }: { value: string; size?: number; label?: string }) {
  const { path, count } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 2;
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
    return { path: d, count: n + quiet * 2 };
  }, [value]);
  return (
    <View style={[s.box, { width: size, height: size }]} accessible accessibilityRole="image" accessibilityLabel={label ?? 'QR code'}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${count} ${count}`}>
        <Rect width={count} height={count} fill="#ffffff" />
        <Path d={path} fill="#0a0d12" />
      </Svg>
    </View>
  );
});

const s = StyleSheet.create({
  box: { alignSelf: 'center', backgroundColor: '#ffffff', borderRadius: 12, padding: 8 },
});
