import type { IAgentRuntime } from '@elizaos/core';
import { generateText, ModelClass, truncateToCompleteSentence } from '@elizaos/core';
import { TwilioService } from '../twilio.js';
import { SafeLogger } from '../../utils/logger.js';

export class SmsHandler {
    private runtime: IAgentRuntime | null = null;

    constructor(private twilio: TwilioService) {}

    async init(runtime: IAgentRuntime) {
        this.runtime = runtime;
        SafeLogger.info('SMS Handler initialized with runtime');
    }

    async generateAndSendSms(
        to: string,
        topic: string,
        runtime: IAgentRuntime,
        directMessage?: string
    ): Promise<string> {
        try {
            // Always use the provided runtime or fallback to initialized one
            const currentRuntime = runtime || this.runtime;
            if (!currentRuntime) {
                throw new Error('Runtime not initialized');
            }

            SafeLogger.info('Generating SMS content for prompt:', topic);

            // Generate the message content
            let messageContent: string;

            if (directMessage) {
                // For direct messages, ensure they end at a complete sentence
                messageContent = truncateToCompleteSentence(directMessage, 160);
            } else {
                const generatedContent = await generateText({
                    context: this.generatePrompt(topic, currentRuntime.character),
                    runtime: currentRuntime,
                    modelClass: ModelClass.MEDIUM,
                    stop: ["\n", "User:", "Assistant:", "."]  // Stop at first period
                });

                if (!generatedContent) {
                    throw new Error('Failed to generate message content');
                }

                // Ensure we have a complete sentence within limits
                messageContent = truncateToCompleteSentence(generatedContent, 160);
            }

            if (!process.env.TWILIO_PHONE_NUMBER) {
                throw new Error('TWILIO_PHONE_NUMBER environment variable is not set');
            }

            // Send the SMS
            await this.twilio.client.messages.create({
                to,
                from: process.env.TWILIO_PHONE_NUMBER,
                body: messageContent
            });

            SafeLogger.info('✅ SMS sent successfully:', {
                to,
                contentLength: messageContent.length,
                message: messageContent // Log the actual message for verification
            });

            return messageContent;

        } catch (error) {
            SafeLogger.error('Failed to send SMS:', error);
            throw error;
        }
    }

    private generatePrompt(topic: string, character: any): string {
        const sanitizeInput = (input: string) => input.replace(/[`${}]/g, '');
        const name = sanitizeInput(character.name || 'Assistant');
        const bio = Array.isArray(character.bio)
            ? character.bio.map(sanitizeInput).join('\n')
            : sanitizeInput(character.bio || '');
        const style = character.style?.all
            ? character.style.all.map(sanitizeInput).join('\n')
            : '';

        return `You are ${character.name}. Generate a very concise SMS message about ${topic}.
        Important: Keep your response to a single complete sentence, ideally under 120 characters.
        Do not use multiple sentences. Be engaging but brief.

        Bio traits to incorporate:
        ${bio}

        Speaking style:
        ${style}`;
    }
}

// Create and export the handler instance
import { twilioService } from '../twilio.js';
export const smsHandler = new SmsHandler(twilioService);