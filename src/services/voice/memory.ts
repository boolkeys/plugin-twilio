import type { VoiceConversationMemory } from '../../types/voice.js';
import { SafeLogger } from '../../utils/logger.js';

export class ConversationMemory {
    private conversations = new Map<string, VoiceConversationMemory>();
    private readonly CONVERSATION_TTL = 30 * 60 * 1000; // 30 minutes

    constructor() {
        setInterval(() => this.cleanupStaleConversations(), 5 * 60 * 1000); // 5 minutes
    }

    private cleanupStaleConversations(): void {
        const now = Date.now();
        for (const [callSid, conversation] of this.conversations.entries()) {
            if (now - conversation.lastActivity > this.CONVERSATION_TTL) {
                this.clearConversation(callSid);
            }
        }
    }

    getConversation(callSid: string): VoiceConversationMemory | undefined {
        return this.conversations.get(callSid);
    }

    createConversation(callSid: string, characterName: string): VoiceConversationMemory {
        const conversation: VoiceConversationMemory = {
            messages: [],
            lastActivity: Date.now(),
            characterName
        };
        this.conversations.set(callSid, conversation);
        return conversation;
    }

    addMessage(callSid: string, role: 'user' | 'assistant', content: string): void {
        const conversation = this.conversations.get(callSid);
        if (!conversation) {
            SafeLogger.error('Attempt to add message to non-existent conversation', { callSid });
            throw new Error('Conversation not found for callSid: ${callSid}');
        }

        if (!content?.trim()) {
            SafeLogger.warn('Attempt to add empty message to conversation', { callSid, role });
            return;
        }

        conversation.messages.push({
            role,
            content,
            timestamp: new Date().toISOString()
        });
        conversation.lastActivity = Date.now();
    }

    clearConversation(callSid: string): void {
        this.conversations.delete(callSid);
    }
}