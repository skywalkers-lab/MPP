export class EventRingBuffer {
    constructor(maxSize) {
        this.buffer = [];
        this.maxSize = maxSize;
    }
    push(event) {
        this.buffer.push(event);
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }
    }
    getAll() {
        return [...this.buffer];
    }
}
