export class RelayAgentAdapter {
    constructor(reducer, relay, logger) {
        this.lastState = null;
        this.relay = relay;
        this.logger = logger;
        reducer.subscribeOnStateChange((state) => {
            this.lastState = state;
            this.relay.sendStateSnapshot(state);
        });
    }
}
