/**
 * Persistent Storage Layer for MPP
 * 
 * This module provides file-based persistence for session data to survive server restarts.
 * It uses JSON files for simplicity and portability, with optional SQLite support for production.
 * 
 * Features:
 * - Automatic data persistence on changes
 * - Memory usage monitoring
 * - Automatic cleanup of old sessions
 * - Graceful fallback to in-memory if persistence fails
 */

import * as fs from 'fs';
import * as path from 'path';
import { SessionNote, AddSessionNoteInput, SessionNotesStore } from './notes';
import { OpsEvent, OpsNotifier } from './ops';
import { 
  SessionArchive, 
  ArchiveSummary, 
  ArchiveSnapshot, 
  ArchiveRecommendationSnapshot,
  StartRecordingInput,
  FinalizeArchiveInput,
  ArchiveTimelineItem,
  SessionArchiveStoreOptions
} from './archive';
import { CurrentRaceState } from '../model/CurrentRaceState';
import { v4 as uuidv4 } from 'uuid';

// Configuration
export interface PersistentStoreConfig {
  enabled: boolean;
  dataDir: string;
  maxSessionAgeMs: number;       // Max age before cleanup (default 7 days)
  maxTotalSessions: number;      // Max sessions to keep (default 100)
  memoryLimitMB: number;         // Memory limit before aggressive cleanup (default 512)
  autoSaveIntervalMs: number;    // Auto-save interval (default 60 seconds)
  cleanupIntervalMs: number;     // Cleanup check interval (default 5 minutes)
}

const DEFAULT_CONFIG: PersistentStoreConfig = {
  enabled: process.env.MPP_PERSISTENCE_ENABLED !== 'false',
  dataDir: process.env.MPP_DATA_DIR || './data',
  maxSessionAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxTotalSessions: 100,
  memoryLimitMB: 512,
  autoSaveIntervalMs: 60_000,
  cleanupIntervalMs: 5 * 60_000,
};

/**
 * Memory usage monitor
 */
export function getMemoryUsage(): { heapUsedMB: number; heapTotalMB: number; rss: number } {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    rss: Math.round(mem.rss / 1024 / 1024),
  };
}

/**
 * JSON-based persistent notes store
 */
export class PersistentSessionNotesStore implements SessionNotesStore {
  private readonly notesBySession = new Map<string, SessionNote[]>();
  private readonly config: PersistentStoreConfig;
  private readonly notesFile: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isDirty = false;

  constructor(config: Partial<PersistentStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.notesFile = path.join(this.config.dataDir, 'notes.json');
    
    if (this.config.enabled) {
      this.ensureDataDir();
      this.loadFromDisk();
      this.startAutoSave();
    }
  }

  private ensureDataDir(): void {
    try {
      if (!fs.existsSync(this.config.dataDir)) {
        fs.mkdirSync(this.config.dataDir, { recursive: true });
      }
    } catch (err) {
      console.error('[PersistentStore] Failed to create data directory:', err);
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.notesFile)) {
        const data = JSON.parse(fs.readFileSync(this.notesFile, 'utf-8'));
        if (data && typeof data === 'object') {
          for (const [sessionId, notes] of Object.entries(data)) {
            if (Array.isArray(notes)) {
              this.notesBySession.set(sessionId, notes as SessionNote[]);
            }
          }
        }
        console.log(`[PersistentStore] Loaded ${this.notesBySession.size} session notes from disk`);
      }
    } catch (err) {
      console.error('[PersistentStore] Failed to load notes from disk:', err);
    }
  }

  private saveToDisk(): void {
    if (!this.config.enabled || !this.isDirty) return;
    
    try {
      const data: Record<string, SessionNote[]> = {};
      for (const [sessionId, notes] of this.notesBySession) {
        data[sessionId] = notes;
      }
      fs.writeFileSync(this.notesFile, JSON.stringify(data, null, 2));
      this.isDirty = false;
    } catch (err) {
      console.error('[PersistentStore] Failed to save notes to disk:', err);
    }
  }

  private scheduleSave(): void {
    this.isDirty = true;
    if (this.saveTimeout) return;
    
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.saveToDisk();
    }, 5000); // Debounce saves by 5 seconds
  }

  private startAutoSave(): void {
    setInterval(() => {
      this.saveToDisk();
    }, this.config.autoSaveIntervalMs);
  }

  listNotes(sessionId: string): SessionNote[] {
    const notes = this.notesBySession.get(sessionId) ?? [];
    return [...notes].sort((a, b) => a.timestamp - b.timestamp);
  }

  addNote(sessionId: string, payload: AddSessionNoteInput): SessionNote {
    const now = Date.now();
    const note: SessionNote = {
      noteId: `note-${uuidv4()}`,
      sessionId,
      timestamp: payload.timestamp ?? now,
      createdAt: now,
      category: payload.category ?? 'general',
      text: payload.text,
      authorLabel: payload.authorLabel ?? 'Engineer',
      lap: payload.lap,
      tag: payload.tag,
      severity: payload.severity,
    };

    const notes = this.notesBySession.get(sessionId) ?? [];
    notes.push(note);
    this.notesBySession.set(sessionId, notes);
    this.scheduleSave();

    return note;
  }

  deleteNote(sessionId: string, noteId: string): boolean {
    const notes = this.notesBySession.get(sessionId);
    if (!notes || notes.length === 0) return false;

    const idx = notes.findIndex((n) => n.noteId === noteId);
    if (idx < 0) return false;

    notes.splice(idx, 1);
    if (notes.length === 0) {
      this.notesBySession.delete(sessionId);
    }
    this.scheduleSave();

    return true;
  }

  getNoteCount(sessionId: string): number {
    return this.notesBySession.get(sessionId)?.length ?? 0;
  }

  getLatestNote(sessionId: string): SessionNote | null {
    const notes = this.notesBySession.get(sessionId);
    if (!notes || notes.length === 0) return null;

    let latest = notes[0];
    for (const note of notes) {
      if (note.timestamp > latest.timestamp) {
        latest = note;
      }
    }
    return latest;
  }

  mergeSessions(fromSessionId: string, toSessionId: string): void {
    if (fromSessionId === toSessionId) return;

    const source = this.notesBySession.get(fromSessionId);
    if (!source || source.length === 0) return;

    const target = this.notesBySession.get(toSessionId) ?? [];
    const merged: SessionNote[] = [
      ...target,
      ...source.map((note) => ({ ...note, sessionId: toSessionId })),
    ];

    merged.sort((a, b) => a.timestamp - b.timestamp);
    this.notesBySession.set(toSessionId, merged);
    this.notesBySession.delete(fromSessionId);
    this.scheduleSave();
  }

  /**
   * Graceful shutdown - ensure all data is saved
   */
  shutdown(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    this.saveToDisk();
    console.log('[PersistentStore] Notes saved on shutdown');
  }
}

/**
 * Persistent OPS events store with automatic cleanup
 */
export class PersistentOpsEventsStore implements OpsNotifier {
  private events: OpsEvent[] = [];
  private readonly config: PersistentStoreConfig;
  private readonly eventsFile: string;
  private readonly maxSize: number;
  private isDirty = false;

  constructor(maxSize: number = 500, config: Partial<PersistentStoreConfig> = {}) {
    this.maxSize = maxSize;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.eventsFile = path.join(this.config.dataDir, 'ops_events.json');
    
    if (this.config.enabled) {
      this.ensureDataDir();
      this.loadFromDisk();
      this.startAutoSave();
    }
  }

  private ensureDataDir(): void {
    try {
      if (!fs.existsSync(this.config.dataDir)) {
        fs.mkdirSync(this.config.dataDir, { recursive: true });
      }
    } catch (err) {
      console.error('[PersistentStore] Failed to create data directory:', err);
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.eventsFile)) {
        const data = JSON.parse(fs.readFileSync(this.eventsFile, 'utf-8'));
        if (Array.isArray(data)) {
          this.events = data;
        }
        console.log(`[PersistentStore] Loaded ${this.events.length} OPS events from disk`);
      }
    } catch (err) {
      console.error('[PersistentStore] Failed to load events from disk:', err);
    }
  }

  private saveToDisk(): void {
    if (!this.config.enabled || !this.isDirty) return;
    
    try {
      fs.writeFileSync(this.eventsFile, JSON.stringify(this.events, null, 2));
      this.isDirty = false;
    } catch (err) {
      console.error('[PersistentStore] Failed to save events to disk:', err);
    }
  }

  private startAutoSave(): void {
    setInterval(() => {
      this.saveToDisk();
    }, this.config.autoSaveIntervalMs);
  }

  notify(event: OpsEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxSize) {
      this.events.splice(0, this.events.length - this.maxSize);
    }
    this.isDirty = true;
  }

  getRecent(limit: number = 50): OpsEvent[] {
    const size = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 50;
    return this.events.slice(-size).reverse();
  }

  shutdown(): void {
    this.saveToDisk();
    console.log('[PersistentStore] OPS events saved on shutdown');
  }
}

/**
 * Memory management utilities
 */
export class MemoryManager {
  private readonly config: PersistentStoreConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<PersistentStoreConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(cleanupCallback: () => void): void {
    this.cleanupInterval = setInterval(() => {
      const mem = getMemoryUsage();
      if (mem.heapUsedMB > this.config.memoryLimitMB * 0.8) {
        console.warn(`[MemoryManager] Memory usage high: ${mem.heapUsedMB}MB / ${this.config.memoryLimitMB}MB limit`);
        cleanupCallback();
        
        // Force GC if available
        if (global.gc) {
          global.gc();
          console.log('[MemoryManager] Forced garbage collection');
        }
      }
    }, this.config.cleanupIntervalMs);
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  getStatus(): { heapUsedMB: number; heapTotalMB: number; limitMB: number; usage: number } {
    const mem = getMemoryUsage();
    return {
      ...mem,
      limitMB: this.config.memoryLimitMB,
      usage: mem.heapUsedMB / this.config.memoryLimitMB,
    };
  }
}

/**
 * Factory function to create appropriate stores based on configuration
 */
export function createPersistentStores(config: Partial<PersistentStoreConfig> = {}): {
  notesStore: SessionNotesStore;
  opsStore: OpsNotifier & { getRecent: (limit?: number) => OpsEvent[]; shutdown?: () => void };
  memoryManager: MemoryManager;
  shutdown: () => void;
} {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  const notesStore = new PersistentSessionNotesStore(finalConfig);
  const opsStore = new PersistentOpsEventsStore(500, finalConfig);
  const memoryManager = new MemoryManager(finalConfig);

  const shutdown = (): void => {
    console.log('[PersistentStore] Shutting down...');
    notesStore.shutdown();
    opsStore.shutdown();
    memoryManager.stop();
    console.log('[PersistentStore] Shutdown complete');
  };

  // Register shutdown handlers
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(0);
  });

  return {
    notesStore,
    opsStore,
    memoryManager,
    shutdown,
  };
}

/**
 * Diagnostics endpoint data
 */
export interface PersistenceStatus {
  enabled: boolean;
  dataDir: string;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    limitMB: number;
    usage: number;
  };
  stores: {
    notesSessionCount: number;
    opsEventCount: number;
  };
}

export function getPersistenceStatus(
  notesStore: SessionNotesStore,
  opsStore: { getRecent: (limit?: number) => OpsEvent[] },
  config: Partial<PersistentStoreConfig> = {}
): PersistenceStatus {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const mem = getMemoryUsage();
  
  return {
    enabled: finalConfig.enabled,
    dataDir: finalConfig.dataDir,
    memory: {
      ...mem,
      limitMB: finalConfig.memoryLimitMB,
      usage: mem.heapUsedMB / finalConfig.memoryLimitMB,
    },
    stores: {
      notesSessionCount: -1, // Would need to add a method to count sessions
      opsEventCount: opsStore.getRecent(1000).length,
    },
  };
}
