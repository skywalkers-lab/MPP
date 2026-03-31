import winston from 'winston';

export class ConsoleLogger {
  private logger: winston.Logger;

  constructor(level: 'info' | 'warn' | 'debug' = 'info') {
    this.logger = winston.createLogger({
      level,
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
      ),
      transports: [new winston.transports.Console()],
    });
  }

  info(msg: string) {
    this.logger.info(msg);
  }
  warn(msg: string) {
    this.logger.warn(msg);
  }
  error(msg: string, err?: any) {
    this.logger.error(`${msg}${err ? ' - ' + (err.stack || err) : ''}`);
  }
  debug(msg: string) {
    this.logger.debug(msg);
  }
}
