import dgram from 'dgram';
import { ConsoleLogger } from '../debug/ConsoleLogger';
import { parsePacketHeader } from '../parsers/PacketHeaderParser';
import { parsePacketById } from '../parsers/PacketParsers';
import { StateReducer } from './StateReducer';

export interface UdpReceiverOptions {
  port: number;
  address?: string;
  logLevel?: 'info' | 'warn' | 'debug';
  verbose?: boolean;
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

  constructor(reducer: StateReducer, logger: ConsoleLogger, options: UdpReceiverOptions) {
    this.reducer = reducer;
    this.logger = logger;
    this.options = options;
    this.socket = dgram.createSocket('udp4');
  }

  start() {
    this.socket.on('message', (msg, rinfo) => {
      try {
        const header = parsePacketHeader(msg);
        if (!header) {
          this.logger.warn('Invalid packet header received');
          this.parseFailCounts['header'] = (this.parseFailCounts['header'] || 0) + 1;
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
          return;
        }
        this.reducer.handlePacket(header, parsed);
        // 주요 상태 요약 info 로그 (1초마다)
        const now = Date.now();
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
      }
    });
    this.socket.on('error', (err) => {
      this.logger.error('UDP socket error', err);
    });
    this.socket.bind(this.options.port, this.options.address, () => {
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
    this.socket.close();
  }
}
