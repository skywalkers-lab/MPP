import { EventLogEntry } from '../model/CurrentRaceState.js';

export class EventRingBuffer {
  private buffer: EventLogEntry[];
  private maxSize: number;

  constructor(maxSize: number) {
    this.buffer = [];
    this.maxSize = maxSize;
  }

  push(event: EventLogEntry) {
    this.buffer.push(event);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getAll(): EventLogEntry[] {
    return [...this.buffer];
  }
}
