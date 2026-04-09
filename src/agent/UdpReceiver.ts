import dgram from 'dgram';
import { ConsoleLogger } from '../debug/ConsoleLogger.js';
import { parsePacketHeader } from '../parsers/PacketHeaderParser.js';
import { parsePacketById } from '../parsers/PacketParsers/index.js';
import { StateReducer } from './StateReducer.js';

export interface UdpReceiverOptions {
  port: number;
  address?: string;
  logLevel?: 'info' | 'warn' | 'debug';
  verbose?: boolean;
}

export interface UdpReceiverDiagnostics {
  started: boolean;
  bindAttempted: boolean;
  bindSucceeded: boolean;
  bindError: string | null;
  udpPort: number;
  udpAddress: string;
  recentPackets10s: number;
  lastPacketAt: number | null;
  lastValidPacketId: number | null;
  lastSessionUID: string | null;
  lastParseSuccessAt: number | null;
  parseFailureCount: number;
  parseFailureByPacketId: Record<string, number>;
}

export class UdpReceiver {
  private socket: dgram.Socket;
  private reducer: StateReducer;
  private logger: ConsoleLogger;
  private options: UdpReceiverOptions;
  private lastSessionUID: string | null = null;
  private packetCounts: Record<number, number> = {};
  private parseFailCounts: Record<string, number> = {};
  private lastLogTime: number = 0;
  private started: boolean = false;
  private bindAttempted: boolean = false;
  private bindSucceeded: boolean = false;
  private bindError: string | null = null;
  private lastPacketAt: number | null = null;
  private lastValidPacketId: number | null = null;
  private lastParseSuccessAt: number | null = null;
  private parseFailureCount: number = 0;
  private packetTimestamps: number[] = [];

  constructor(reducer: StateReducer, logger: ConsoleLogger, options: UdpReceiverOptions) {
    this.reducer = reducer;
    this.logger = logger;
    this.options = options;
    this.socket = dgram.createSocket('udp4');
  }

  start() {
    this.bindAttempted = true;
    this.socket.on('message', (msg, rinfo) => {
      const now = Date.now();
      this.lastPacketAt = now;
      this.packetTimestamps.push(now);
      this.prunePacketTimestamps(now);
      try {
        const header = parsePacketHeader(msg);
        if (!header) {
          this.logger.warn('Invalid packet header received');
          this.parseFailCounts['header'] = (this.parseFailCounts['header'] || 0) + 1;
          this.parseFailureCount += 1;
          return;
        }
        this.packetCounts[header.packetId] = (this.packetCounts[header.packetId] || 0) + 1;
        if (this.options.verbose) {
          this.logger.debug(`Received packetId=${header.packetId} from ${rinfo.address}:${rinfo.port}`);
        }
        if (header.sessionUID && header.sessionUID !== this.lastSessionUID) {
          this.logger.info(`Session change detected: ${this.lastSessionUID} -> ${header.sessionUID}`);
          this.lastSessionUID = header.sessionUID;
        }
        const parsed = parsePacketById(header.packetId, msg);
        if (!parsed) {
          this.logger.warn(`Unknown or unhandled packetId: ${header.packetId}`);
          this.parseFailCounts[header.packetId] = (this.parseFailCounts[header.packetId] || 0) + 1;
          this.parseFailureCount += 1;
          return;
        }
        this.lastValidPacketId = header.packetId;
        this.lastParseSuccessAt = now;
        this.reducer.handlePacket(header, parsed);
        // 주요 상태 요약 info 로그 (1초마다)
        if (now - this.lastLogTime > 1000) {
          const state = this.reducer.getState();
          const player = state.playerCarIndex != null ? state.cars[state.playerCarIndex] : null;
          this.logger.info(
            `[F1] sessionType=${state.sessionMeta?.sessionType ?? 'null'} trackId=${state.sessionMeta?.trackId ?? 'null'} ` +
            `playerCarIndex=${state.playerCarIndex ?? 'null'} lap=${player?.currentLapNum ?? 'null'} pos=${player?.position ?? 'null'} events=${state.eventLog.length}`
          );
          this.lastLogTime = now;
        }
        // self-check: 비정상 값 경고
        this.selfCheck();
      } catch (e) {
        this.logger.error('Packet parse error', e);
        this.parseFailureCount += 1;
      }
    });
    this.socket.on('error', (err) => {
      this.logger.error('UDP socket error', err);
      this.bindError = err instanceof Error ? err.message : String(err);
      this.bindSucceeded = false;
    });
    this.socket.bind(this.options.port, this.options.address, () => {
      this.started = true;
      this.bindSucceeded = true;
      this.bindError = null;
      this.logger.info(`UDP listening on ${this.options.address || '0.0.0.0'}:${this.options.port}`);
    });
    // verbose 모드에서 packetId별 수신/실패 빈도 주기적 출력
    if (this.options.verbose) {
      setInterval(() => {
        this.logger.debug('[F1] packetId counts: ' + JSON.stringify(this.packetCounts));
        this.logger.debug('[F1] parseFail counts: ' + JSON.stringify(this.parseFailCounts));
      }, 5000);
    }
  }

  getDiagnosticsSnapshot(now: number = Date.now()): UdpReceiverDiagnostics {
    this.prunePacketTimestamps(now);
    return {
      started: this.started,
      bindAttempted: this.bindAttempted,
      bindSucceeded: this.bindSucceeded,
      bindError: this.bindError,
      udpPort: this.options.port,
      udpAddress: this.options.address || '0.0.0.0',
      recentPackets10s: this.packetTimestamps.length,
      lastPacketAt: this.lastPacketAt,
      lastValidPacketId: this.lastValidPacketId,
      lastSessionUID: this.lastSessionUID,
      lastParseSuccessAt: this.lastParseSuccessAt,
      parseFailureCount: this.parseFailureCount,
      parseFailureByPacketId: { ...this.parseFailCounts },
    };
  }

  private prunePacketTimestamps(now: number): void {
    const cutoff = now - 10_000;
    while (this.packetTimestamps.length > 0 && this.packetTimestamps[0] < cutoff) {
      this.packetTimestamps.shift();
    }
  }

  private selfCheck() {
    const state = this.reducer.getState();
    const player = state.playerCarIndex != null ? state.cars[state.playerCarIndex] : null;
    if (!player) return;
    if (player.currentLapNum != null && (player.currentLapNum < 0 || player.currentLapNum > 200)) {
      this.logger.warn(`[self-check] currentLapNum abnormal: ${player.currentLapNum}`);
    }
    if (state.playerCarIndex != null && (state.playerCarIndex < 0 || state.playerCarIndex > 21)) {
      this.logger.warn(`[self-check] playerCarIndex out of range: ${state.playerCarIndex}`);
    }
    if (player.fuelLapsRemaining != null && (player.fuelLapsRemaining < 0 || player.fuelLapsRemaining > 200)) {
      this.logger.warn(`[self-check] fuelLapsRemaining abnormal: ${player.fuelLapsRemaining}`);
    }
    if (player.tyreAgeLaps != null && player.tyreAgeLaps < 0) {
      this.logger.warn(`[self-check] tyreAgeLaps negative: ${player.tyreAgeLaps}`);
    }
    if (player.damage) {
      for (const [k, v] of Object.entries(player.damage)) {
        if (v != null && (v < 0 || v > 100)) {
          this.logger.warn(`[self-check] damage ${k} abnormal: ${v}`);
        }
      }
    }
    const driverName =
      state.playerCarIndex != null
        ? state.drivers[state.playerCarIndex]?.driverName
        : undefined;
    if (driverName && /[^\x20-\x7E]/.test(driverName)) {
      this.logger.warn(`[self-check] driverName may be broken: ${driverName}`);
    }
  }

  stop() {
    this.started = false;
    this.socket.close();
  }
}
