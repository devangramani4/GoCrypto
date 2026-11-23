import Clipboard from '@react-native-clipboard/clipboard';

/** System clipboard (wrapper so screens do not depend on the native module directly). */
export const clipboard = {
  copy(text: string): void {
    Clipboard.setString(text);
  },
  paste(): Promise<string> {
    return Clipboard.getString();
  },
};
