import { v4 as uuidv4 } from 'uuid';
export const NOTE_MAX_TEXT_LENGTH = 400;
export const NOTE_ALLOWED_CATEGORIES = ['general', 'incident', 'strategy', 'pit', 'risk'];
export const NOTE_ALLOWED_AUTHOR_LABELS = ['Engineer', 'Strategist', 'Pit Wall', 'Observer'];
export const NOTE_ALLOWED_SEVERITIES = ['low', 'medium', 'high'];
export class InMemorySessionNotesStore {
    constructor() {
        this.notesBySession = new Map();
    }
    listNotes(sessionId) {
        const notes = this.notesBySession.get(sessionId) ?? [];
        return [...notes].sort((a, b) => a.timestamp - b.timestamp);
    }
    addNote(sessionId, payload) {
        const now = Date.now();
        const note = {
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
        return note;
    }
    deleteNote(sessionId, noteId) {
        const notes = this.notesBySession.get(sessionId);
        if (!notes || notes.length === 0)
            return false;
        const idx = notes.findIndex((n) => n.noteId === noteId);
        if (idx < 0)
            return false;
        notes.splice(idx, 1);
        if (notes.length === 0) {
            this.notesBySession.delete(sessionId);
        }
        return true;
    }
    getNoteCount(sessionId) {
        return this.notesBySession.get(sessionId)?.length ?? 0;
    }
    getLatestNote(sessionId) {
        const notes = this.notesBySession.get(sessionId);
        if (!notes || notes.length === 0)
            return null;
        let latest = notes[0];
        for (const note of notes) {
            if (note.timestamp > latest.timestamp) {
                latest = note;
            }
        }
        return latest;
    }
}
