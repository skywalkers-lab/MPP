import {
  buildViewerRoomsUrl,
  deriveRelayWsUrl,
  normalizeViewerBaseUrl,
  sanitizeDesktopConfig,
  type DesktopLaunchMode,
} from '../src/desktop/config';

describe('desktop config helpers', () => {
  it('normalizes viewer base URLs and derives rooms URLs', () => {
    expect(normalizeViewerBaseUrl('mpp-relay.onrender.com/')).toBe('https://mpp-relay.onrender.com');
    expect(normalizeViewerBaseUrl('https://mpp-relay.onrender.com/app/')).toBe('https://mpp-relay.onrender.com/app');
    expect(buildViewerRoomsUrl('https://mpp-relay.onrender.com')).toBe('https://mpp-relay.onrender.com/rooms');
    expect(buildViewerRoomsUrl('https://mpp-relay.onrender.com/app')).toBe('https://mpp-relay.onrender.com/app/rooms');
  });

  it('derives websocket endpoints from viewer URLs', () => {
    expect(deriveRelayWsUrl('https://mpp-relay.onrender.com')).toBe('wss://mpp-relay.onrender.com');
    expect(deriveRelayWsUrl('http://127.0.0.1:4100')).toBe('ws://127.0.0.1:4100');
  });

  it('sanitizes invalid launcher config values', () => {
    const invalidMode = 'bogus' as unknown as DesktopLaunchMode;
    const config = sanitizeDesktopConfig({
      viewerBaseUrl: 'mpp-relay.onrender.com',
      relayWsUrl: '',
      launchMode: invalidMode,
      autoLaunch: true,
      udpPort: -1,
      udpAddr: '',
    });

    expect(config.viewerBaseUrl).toBe('https://mpp-relay.onrender.com');
    expect(config.relayWsUrl).toBe('wss://mpp-relay.onrender.com');
    expect(config.launchMode).toBe('manual');
    expect(config.autoLaunch).toBe(true);
    expect(config.udpPort).toBe(20777);
    expect(config.udpAddr).toBe('0.0.0.0');
  });
});