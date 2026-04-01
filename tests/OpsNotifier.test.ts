import {
  OpsEvent,
  OpsEventType,
  InMemoryRecentOpsEvents,
  ConsoleOpsNotifier,
  CompositeOpsNotifier,
  OpsNotifier,
} from '../src/relay/ops';

describe('OpsNotifier', () => {
  describe('InMemoryRecentOpsEvents', () => {
    it('should enforce capacity limit and maintain latest events', () => {
      const maxSize = 5;
      const notifier = new InMemoryRecentOpsEvents(maxSize);

      // Add more events than maxSize
      for (let i = 0; i < 10; i++) {
        const event: OpsEvent = {
          eventId: `event-${i}`,
          type: 'session_started' as OpsEventType,
          sessionId: `session-${i}`,
          timestamp: Date.now() + i,
          payload: { index: i },
        };
        notifier.notify(event);
      }

      // Should only keep the latest 5 events
      const recent = notifier.getRecent(maxSize);
      expect(recent).toHaveLength(maxSize);

      // Should return latest-first ordering
      expect(recent[0].payload?.index).toBe(9);
      expect(recent[1].payload?.index).toBe(8);
      expect(recent[2].payload?.index).toBe(7);
      expect(recent[3].payload?.index).toBe(6);
      expect(recent[4].payload?.index).toBe(5);
    });

    it('should return events in latest-first order and respect limit parameter', () => {
      const notifier = new InMemoryRecentOpsEvents(100);

      // Add 10 events
      for (let i = 0; i < 10; i++) {
        const event: OpsEvent = {
          eventId: `event-${i}`,
          type: 'session_closed' as OpsEventType,
          sessionId: 'test-session',
          timestamp: Date.now() + i,
        };
        notifier.notify(event);
      }

      // Request only 3 latest
      const recent = notifier.getRecent(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].eventId).toBe('event-9');
      expect(recent[1].eventId).toBe('event-8');
      expect(recent[2].eventId).toBe('event-7');
    });
  });

  describe('CompositeOpsNotifier', () => {
    it('should forward notify() to all registered notifiers', () => {
      const mockNotifier1: OpsNotifier = {
        notify: jest.fn(),
      };
      const mockNotifier2: OpsNotifier = {
        notify: jest.fn(),
      };

      const composite = new CompositeOpsNotifier([mockNotifier1, mockNotifier2]);

      const testEvent: OpsEvent = {
        eventId: 'test-event',
        type: 'share_enabled_changed' as OpsEventType,
        sessionId: 'test-session',
        timestamp: Date.now(),
        payload: { shareEnabled: true },
      };

      composite.notify(testEvent);

      expect(mockNotifier1.notify).toHaveBeenCalledWith(testEvent);
      expect(mockNotifier2.notify).toHaveBeenCalledWith(testEvent);
      expect(mockNotifier1.notify).toHaveBeenCalledTimes(1);
      expect(mockNotifier2.notify).toHaveBeenCalledTimes(1);
    });

    it('should handle empty notifier list gracefully', () => {
      const composite = new CompositeOpsNotifier([]);

      const testEvent: OpsEvent = {
        eventId: 'test-event',
        type: 'visibility_changed' as OpsEventType,
        sessionId: 'test-session',
        timestamp: Date.now(),
      };

      // Should not throw
      expect(() => composite.notify(testEvent)).not.toThrow();
    });

    it('should continue forwarding to remaining notifiers if one throws', () => {
      const notifier1: OpsNotifier = {
        notify: jest.fn(() => {
          throw new Error('notifier1 error');
        }),
      };
      const notifier2: OpsNotifier = {
        notify: jest.fn(),
      };

      const composite = new CompositeOpsNotifier([notifier1, notifier2]);

      const testEvent: OpsEvent = {
        eventId: 'test-event',
        type: 'session_stale' as OpsEventType,
        sessionId: 'test-session',
        timestamp: Date.now(),
      };

      // CompositeOpsNotifier should handle errors gracefully
      expect(() => composite.notify(testEvent)).not.toThrow();

      // Both notifiers should have been called despite first throwing
      expect(notifier1.notify).toHaveBeenCalledWith(testEvent);
      expect(notifier2.notify).toHaveBeenCalledWith(testEvent);
    });
  });

  describe('ConsoleOpsNotifier', () => {
    it('should log ops events to console', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const notifier = new ConsoleOpsNotifier();

      const testEvent: OpsEvent = {
        eventId: 'test-123',
        type: 'session_started' as OpsEventType,
        sessionId: 'session-abc',
        timestamp: 1609459200000,
        payload: { joinCode: 'xyz' },
      };

      notifier.notify(testEvent);

      expect(consoleSpy).toHaveBeenCalled();
      const logCall = consoleSpy.mock.calls[0][0];
      expect(logCall).toContain('[OpsEvent]');
      expect(logCall).toContain('session_started');
      expect(logCall).toContain('session-abc');

      consoleSpy.mockRestore();
    });
  });
});
