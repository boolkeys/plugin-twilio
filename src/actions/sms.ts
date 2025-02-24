import { Action, truncateToCompleteSentence } from '@elizaos/core';
import { smsHandler } from '../services/sms/handler.js';
import { SafeLogger } from '../utils/logger.js';

// Improved phone number regex that validates:
// - Must start with +
// - Country code must be 1-3 digits
// - Area code must be present
// - Total length must be between 10-15 digits (excluding +)
// - No spaces or special characters allowed except +
const PHONE_PATTERN = /^\+(?:[1-9]\d{1,2})(?:\d{9,12})$/;

// Command pattern with improved phone number validation
const SMS_PATTERN = /send (?:an? )?(?:sms|text|message) to (\+\d{1,3}\d{9,12}) (?:saying|telling|about|with) (.*)/i;

export const sms: Action = {
    name: 'sms',
    description: 'Send SMS messages via Twilio',
    similes: ['SEND_TEXT', 'TEXT_MESSAGE', 'SMS_MESSAGE'],

    validate: async (runtime, message) => {
        const text = message.content.text;
        if (!text) return false;

        const triggerPhrases = [
            'send sms',
            'send text',
            'send message',
            'sms to',
            'text to',
            'message to'
        ];

        // Case insensitive check for any trigger phrase
        const normalizedInput = text.toLowerCase();
        const hasValidTrigger = triggerPhrases.some(phrase =>
            normalizedInput.includes(phrase.toLowerCase())
        );

        // If trigger phrase found, validate phone number format
        if (hasValidTrigger) {
            const phoneMatch = text.match(SMS_PATTERN);
            if (!phoneMatch) return false;

            const [, phoneNumber] = phoneMatch;
            return PHONE_PATTERN.test(phoneNumber);
        }

        return false;
    },

    handler: async (runtime, message) => {
        try {
            const text = message.content.text;
            const phoneMatch = text.match(SMS_PATTERN);

            if (!phoneMatch) {
                throw new Error('Invalid SMS command format');
            }

            const [, phoneNumber, content] = phoneMatch;

            // Additional phone number validation
            if (!PHONE_PATTERN.test(phoneNumber)) {
                throw new Error('Invalid phone number format');
            }

            const isDirectMessage = text.toLowerCase().includes(' saying ');

            // If it's a direct message, ensure it ends at a sentence boundary
            const processedContent = isDirectMessage ?
                truncateToCompleteSentence(content.trim(), 160) :
                content.trim();

            // Generate and send SMS
            const messageContent = await smsHandler.generateAndSendSms(
                phoneNumber,
                processedContent,
                runtime,
                isDirectMessage ? processedContent : undefined
            );

            return {
                success: true,
                message: `SMS sent to ${phoneNumber}: "${messageContent}"`
            };

        } catch (error) {
            SafeLogger.error('Failed to send SMS:', error);

            if (error instanceof Error) {
                const errorMessage = error.message.toLowerCase();
                if (errorMessage.includes('invalid') || errorMessage.includes('not a valid phone number')) {
                    return {
                        success: false,
                        message: 'Invalid phone number format. Please use international format (e.g., +1234567890)'
                    };
                }
                if (errorMessage.includes('permission')) {
                    return {
                        success: false,
                        message: "Sorry, I don't have permission to text this number. It might need to be verified first."
                    };
                }
            }
            throw error;
        }
    },

    examples: [
        [{
            user: 'user',
            content: {
                text: 'Send an SMS to +1234567890 saying Hello from the AI!'
            }
        }],
        [{
            user: 'user',
            content: {
                text: 'Send SMS to +1234567890 about the weather forecast'
            }
        }]
    ]
};