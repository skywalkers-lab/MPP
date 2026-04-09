export type DesktopLaunchMode = 'manual' | 'engineer' | 'driver';

export interface DesktopConfig {
  viewerBaseUrl: string;
  relayWsUrl: string;
  launchMode: DesktopLaunchMode;
  autoLaunch: boolean;
  udpPort: number;
  udpAddr: string;
}

const DEFAULT_UDP_PORT = 20777;
const DEFAULT_UDP_ADDR = '0.0.0.0';

export function normalizeViewerBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  const withProtocol = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  const normalizedPath = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${normalizedPath}`;
}

export function deriveRelayWsUrl(viewerBaseUrl: string): string {
  const normalized = normalizeViewerBaseUrl(viewerBaseUrl);
  if (!normalized) return '';

  const viewerUrl = new URL(normalized);
  const protocol = viewerUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${viewerUrl.host}`;
}

export function buildViewerRoomsUrl(viewerBaseUrl: string): string {
  const normalized = normalizeViewerBaseUrl(viewerBaseUrl);
  if (!normalized) return '';

  const base = new URL(normalized);
  if (!base.pathname.endsWith('/')) {
    base.pathname = `${base.pathname}/`;
  }
  return new URL('rooms', base).toString();
}

export function sanitizeLaunchMode(raw: string | undefined | null): DesktopLaunchMode {
  if (raw === 'driver' || raw === 'engineer' || raw === 'manual') {
    return raw;
  }
  return 'manual';
}

export function sanitizeDesktopConfig(
  input: Partial<DesktopConfig> | null | undefined,
  defaults?: Partial<DesktopConfig>
): DesktopConfig {
  const merged = {
    viewerBaseUrl: defaults?.viewerBaseUrl ?? '',
    relayWsUrl: defaults?.relayWsUrl ?? '',
    launchMode: defaults?.launchMode ?? 'manual',
    autoLaunch: defaults?.autoLaunch ?? false,
    udpPort: defaults?.udpPort ?? DEFAULT_UDP_PORT,
    udpAddr: defaults?.udpAddr ?? DEFAULT_UDP_ADDR,
    ...(input || {}),
  };

  const viewerBaseUrl = normalizeViewerBaseUrl(String(merged.viewerBaseUrl || ''));
  const relayWsUrl = String(merged.relayWsUrl || '').trim() || deriveRelayWsUrl(viewerBaseUrl);
  const udpPort = Number.isInteger(merged.udpPort) && Number(merged.udpPort) > 0 && Number(merged.udpPort) <= 65535
    ? Number(merged.udpPort)
    : DEFAULT_UDP_PORT;
  const udpAddr = String(merged.udpAddr || '').trim() || DEFAULT_UDP_ADDR;

  return {
    viewerBaseUrl,
    relayWsUrl,
    launchMode: sanitizeLaunchMode(String(merged.launchMode || 'manual')),
    autoLaunch: merged.autoLaunch === true,
    udpPort,
    udpAddr,
  };
}

export function validateDesktopConfig(config: DesktopConfig): string[] {
  const errors: string[] = [];

  if (!config.viewerBaseUrl) {
    errors.push('Public Viewer URL을 입력하세요.');
  }

  if (!config.relayWsUrl) {
    errors.push('Relay WebSocket URL을 입력하세요.');
  } else {
    try {
      const url = new URL(config.relayWsUrl);
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        errors.push('Relay WebSocket URL은 ws:// 또는 wss:// 로 시작해야 합니다.');
      }
    } catch {
      errors.push('Relay WebSocket URL 형식이 올바르지 않습니다.');
    }
  }

  return errors;
}