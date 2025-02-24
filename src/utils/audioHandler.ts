// /packages/plugin-twilio/src/utils/audioHandler.ts

import { SafeLogger } from './logger.js';

interface AudioEntry {
    buffer: Buffer;
    timestamp: number;
    size: number;
}

export class AudioHandler {
    private audioStore = new Map<string, AudioEntry>();
    private readonly MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB
    private readonly TTL = 15 * 60 * 1000; // 15 minutes
    private currentSize = 0;

    constructor() {
        // Run cleanup every minute
        setInterval(() => this.cleanup(), 60 * 1000);
    }

    addAudio(buffer: Buffer): string {
        this.cleanup(); // Clean up before adding new entry

        const audioId = this.generateId();
        const size = buffer.length;

        // Check if adding this would exceed max size
        if (this.currentSize + size > this.MAX_CACHE_SIZE) {
            this.evictOldest();
        }

        this.audioStore.set(audioId, {
            buffer,
            timestamp: Date.now(),
            size
        });
        this.currentSize += size;

        SafeLogger.info('Added audio to cache:', {
            id: audioId,
            size: `${(size / 1024).toFixed(2)}KB`,
            totalSize: `${(this.currentSize / 1024 / 1024).toFixed(2)}MB`
        });

        return audioId;
    }

    getAudio(id: string): Buffer | undefined {
        const entry = this.audioStore.get(id);
        if (!entry) return undefined;

        // Update timestamp on access
        entry.timestamp = Date.now();
        return entry.buffer;
    }

    private cleanup() {
        const now = Date.now();
        let removed = 0;
        let freedSpace = 0;

        for (const [id, entry] of this.audioStore.entries()) {
            if (now - entry.timestamp > this.TTL) {
                this.audioStore.delete(id);
                this.currentSize -= entry.size;
                removed++;
                freedSpace += entry.size;
            }
        }

        if (removed > 0) {
            SafeLogger.info('Cleaned up expired audio entries:', {
                removed,
                freedSpace: `${(freedSpace / 1024).toFixed(2)}KB`,
                remainingSize: `${(this.currentSize / 1024 / 1024).toFixed(2)}MB`
            });
        }
    }

    private evictOldest() {
        let oldest: { id: string; timestamp: number } | null = null;

        // Find oldest entry
        for (const [id, entry] of this.audioStore.entries()) {
            if (!oldest || entry.timestamp < oldest.timestamp) {
                oldest = { id, timestamp: entry.timestamp };
            }
        }

        // Remove oldest entry if found
        if (oldest) {
            const entry = this.audioStore.get(oldest.id);
            if (entry) {
                this.audioStore.delete(oldest.id);
                this.currentSize -= entry.size;
                SafeLogger.info('Evicted oldest audio entry:', {
                    id: oldest.id,
                    age: `${((Date.now() - entry.timestamp) / 1000 / 60).toFixed(1)}min`,
                    freedSpace: `${(entry.size / 1024).toFixed(2)}KB`
                });
            }
        }
    }

    private generateId(): string {
        return Math.random().toString(36).substring(2, 15);
    }
}

// Export singleton instance
export const audioHandler = new AudioHandler();