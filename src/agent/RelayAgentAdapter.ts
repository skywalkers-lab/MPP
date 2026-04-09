// agent/RelayAgentAdapter.ts
// StateReducer에서 CurrentRaceState가 갱신될 때 RelayClient로 전송하는 어댑터
import { RelayClient } from '../relay/RelayClient.js';
import { StateReducer } from './StateReducer.js';
import { ConsoleLogger } from '../debug/ConsoleLogger.js';

export class RelayAgentAdapter {
  private lastState: any = null;
  private relay: RelayClient;
  private logger: ConsoleLogger;

  constructor(reducer: StateReducer, relay: RelayClient, logger: ConsoleLogger) {
    this.relay = relay;
    this.logger = logger;
    reducer.subscribeOnStateChange((state) => {
      this.lastState = state;
      this.relay.sendStateSnapshot(state);
    });
  }
}
