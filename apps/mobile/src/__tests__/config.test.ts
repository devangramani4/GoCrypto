import { resolveDevHost } from '../config';

const dev = (os: string, metroHost?: string) => ({ isDev: true, os, metroHost });

describe('resolveDevHost', () => {
  it('leaves release builds untouched', () => {
    expect(resolveDevHost('http://localhost:4000', { isDev: false, os: 'android', metroHost: '192.168.1.5' })).toBe(
      'http://localhost:4000',
    );
  });

  it('points localhost at the machine running Metro (physical devices)', () => {
    expect(resolveDevHost('http://localhost:4000/api', dev('ios', '192.168.1.5'))).toBe('http://192.168.1.5:4000/api');
    expect(resolveDevHost('http://127.0.0.1:4001', dev('android', '192.168.1.5'))).toBe('http://192.168.1.5:4001');
  });

  it('uses the Android emulator host alias when Metro runs on the same machine', () => {
    expect(resolveDevHost('http://localhost:4001', dev('android', 'localhost'))).toBe('http://10.0.2.2:4001');
  });

  it('keeps localhost on the iOS simulator', () => {
    expect(resolveDevHost('http://localhost:4000', dev('ios'))).toBe('http://localhost:4000');
  });

  it('never rewrites real hosts', () => {
    expect(resolveDevHost('https://api.gocrypto.example', dev('android', '10.0.0.2'))).toBe(
      'https://api.gocrypto.example',
    );
  });
});
