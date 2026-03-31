import winston from 'winston';
export class ConsoleLogger {
    constructor(level = 'info') {
        this.logger = winston.createLogger({
            level,
            format: winston.format.combine(winston.format.colorize(), winston.format.timestamp(), winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)),
            transports: [new winston.transports.Console()],
        });
    }
    info(msg) {
        this.logger.info(msg);
    }
    warn(msg) {
        this.logger.warn(msg);
    }
    error(msg, err) {
        this.logger.error(`${msg}${err ? ' - ' + (err.stack || err) : ''}`);
    }
    debug(msg) {
        this.logger.debug(msg);
    }
}
