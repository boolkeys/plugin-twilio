import type { Request, Response } from 'express';
import type { IAgentRuntime, Character } from '@elizaos/core';
import type { VoiceSettings } from '../../types/voice.js';
import twilio from 'twilio';
import { TextToSpeechService } from './tts.js';
import { ConversationMemory } from './memory.js';
import { TwilioService } from '../twilio.js';
import { SafeLogger } from '../../utils/logger.js';
import { audioHandler } from '../../utils/audioHandler.js';
import { generateText, ModelClass, truncateToCompleteSentence } from '@elizaos/core';
import { elevenLabsService } from '../elevenlabs.js';
import { twilioService } from '../twilio.js';

export class VoiceHandler {
    private callRuntimes = new Map<string, IAgentRuntime>();
    private defaultRuntime: IAgentRuntime | null = null;
    private audioCache = new Map<string, string>();  // Cache audio IDs

    // Base goodbye phrases that work for any character
    private readonly BASE_GOODBYE_PHRASES = [
        'goodbye', 'bye', 'bye bye', 'hang up',
        'see you', 'talk to you later', 'have a good day',
        'good bye', 'end call', 'that will be all'
    ];

    constructor(
        private tts: TextToSpeechService,
        private memory: ConversationMemory,
        private twilio: TwilioService
    ) {}

    // Add method to pre-generate common responses
    private async preGenerateCommonResponses(runtime: IAgentRuntime) {
        const commonPhrases = [
            "I didn't catch that. Could you please repeat?",
            "Could you say that again?",
            "I'm having trouble hearing you. One more time?"
        ];

        for (const phrase of commonPhrases) {
            const voiceSettings = this.convertVoiceSettings(runtime.character?.settings?.voice?.elevenlabs);
            const audioBuffer = await this.tts.convertToSpeech(phrase, voiceSettings);
            const audioId = audioHandler.addAudio(audioBuffer);
            this.audioCache.set(phrase, audioId);
        }
    }

    async init(runtime: IAgentRuntime) {
        this.defaultRuntime = runtime;
        await this.preGenerateCommonResponses(runtime);
        SafeLogger.info('Voice handler initialized with runtime');
    }

    private generatePrompt(topic: string, character: Character): string {
        return `You are ${character.name}. Generate a VERY BRIEF voice response about ${topic}.
        IMPORTANT: Keep response under 100 characters. Use ONE short statement and ONE question.
        Example: "The border is WEAK. What's your plan to FIX IT?"

        Bio traits to incorporate:
        ${Array.isArray(character.bio) ? character.bio.join('\n') : character.bio || ''}

        Speaking style:
        ${character.style?.all ? character.style.all.join('\n') : ''}`;
    }

    private generateGreetingPrompt(topic: string | undefined, character: Character): string {
        if (!topic) {
            return this.generatePrompt('greeting', character);
        }

        return `You are ${character.name}. Generate a VERY BRIEF voice greeting about ${topic}.
        IMPORTANT: Keep response under 250 characters. Mention that you're calling specifically to discuss ${topic}.
        Make it engaging and invite discussion.

        Bio traits to incorporate:
        ${Array.isArray(character.bio) ? character.bio.join('\n') : character.bio || ''}

        Speaking style:
        ${character.style?.all ? character.style.all.join('\n') : ''}`;
    }

    private convertVoiceSettings(settings: any): Partial<VoiceSettings> | undefined {
        if (!settings) return undefined;
        return {
            voiceId: settings.voiceId,
            model: settings.model,
            stability: Number(settings.stability),
            similarityBoost: Number(settings.similarityBoost),
            style: Number(settings.style),
            useSpeakerBoost: Boolean(settings.useSpeakerBoost)
        };
    }

    private async handleNewCall(callSid: string, runtime: IAgentRuntime, twiml: twilio.twiml.VoiceResponse, topic?: string) {
        SafeLogger.info('🆕 Handling new call:', { callSid, topic });

        if (!process.env.WEBHOOK_BASE_URL) {
            throw new Error('WEBHOOK_BASE_URL not set in environment');
        }

        // Generate greeting with topic if provided
        const greeting = await generateText({
            context: this.generateGreetingPrompt(topic, runtime.character),
            runtime,
            modelClass: ModelClass.SMALL,
            stop: ["\n", "User:", "Assistant:"]
        });

        // Ensure we have complete sentences within a reasonable length
        const processedGreeting = truncateToCompleteSentence(greeting, 250);
        SafeLogger.info('Generated greeting:', {
            originalLength: greeting.length,
            processedLength: processedGreeting.length,
            text: processedGreeting
        });

        // Convert to speech
        const voiceSettings = this.convertVoiceSettings(runtime.character?.settings?.voice?.elevenlabs);
        const audioBuffer = await this.tts.convertToSpeech(processedGreeting, voiceSettings);
        const audioId = audioHandler.addAudio(audioBuffer);

        // Initialize conversation
        this.memory.createConversation(callSid, runtime.character?.name || 'AI Assistant');
        this.memory.addMessage(callSid, 'assistant', processedGreeting);

        // Play greeting and gather speech input
        twiml.play(`${process.env.WEBHOOK_BASE_URL}/audio/${audioId}`);

        // Add gather after playing greeting to keep call open
        const gather = twiml.gather({
            input: ['speech'],
            timeout: 5,  // Increased to 5 seconds
            action: '/webhook/voice?gatherCallback=true',
            method: 'POST',
            language: 'en-US'
        });

        SafeLogger.info('✅ New call handled successfully');
    }

    private isGoodbye(speech: string, runtime: IAgentRuntime): boolean {
        if (!runtime.character) return false;

        const normalizedSpeech = speech.toLowerCase().trim();
        return this.BASE_GOODBYE_PHRASES.some(phrase =>
            normalizedSpeech.includes(phrase.toLowerCase())
        );
    }

    // Use cached audio for no-speech responses
    private async handleUserSpeech(callSid: string, speech: string | undefined, runtime: IAgentRuntime, twiml: twilio.twiml.VoiceResponse) {
        if (!process.env.WEBHOOK_BASE_URL) {
            throw new Error('WEBHOOK_BASE_URL not set in environment');
        }

        // Handle silence timeout
        if (!speech) {
            const timeoutMessage = "I haven't heard from you for a while. Goodbye!";
            const audioBuffer = await this.tts.convertToSpeech(
                timeoutMessage,
                this.convertVoiceSettings(runtime.character?.settings?.voice?.elevenlabs)
            );
            const audioId = audioHandler.addAudio(audioBuffer);
            twiml.play(`${process.env.WEBHOOK_BASE_URL}/audio/${audioId}`);
            twiml.hangup();
            return;
        }

        // Check for goodbye phrases
        if (this.isGoodbye(speech, runtime)) {
            // Generate character-appropriate goodbye using the prompt system
            const goodbyeResponse = await generateText({
                context: this.generatePrompt('saying goodbye', runtime.character),
                runtime,
                modelClass: ModelClass.SMALL,
                stop: ["\n", "User:", "Assistant:"]
            });

            const audioBuffer = await this.tts.convertToSpeech(
                goodbyeResponse,
                this.convertVoiceSettings(runtime.character?.settings?.voice?.elevenlabs)
            );
            const audioId = audioHandler.addAudio(audioBuffer);
            twiml.play(`${process.env.WEBHOOK_BASE_URL}/audio/${audioId}`);
            twiml.hangup();
            return;
        }

        // Log safely - only log length and first few words
        SafeLogger.info('🗣️ Processing user speech:', {
            length: speech.length,
            preview: speech.split(' ').slice(0, 3).join(' ') + '...',
            callSid
        });

        // Generate response with faster model
        const response = await generateText({
            context: this.generatePrompt(speech, runtime.character),
            runtime,
            modelClass: ModelClass.SMALL,
            stop: ["\n", "User:", "Assistant:"]
        });

        // Process response to ensure complete sentences
        const processedResponse = truncateToCompleteSentence(response, 250);
        SafeLogger.info('Generated response:', {
            originalLength: response.length,
            processedLength: processedResponse.length,
            text: processedResponse
        });

        // Convert to speech
        const voiceSettings = this.convertVoiceSettings(runtime.character?.settings?.voice?.elevenlabs);
        const audioBuffer = await this.tts.convertToSpeech(processedResponse, voiceSettings);
        const audioId = audioHandler.addAudio(audioBuffer);

        // Update conversation
        this.memory.addMessage(callSid, 'user', speech);
        this.memory.addMessage(callSid, 'assistant', processedResponse);

        // Play response
        twiml.play(`${process.env.WEBHOOK_BASE_URL}/audio/${audioId}`);

        // After playing response, gather next input
        const gather = twiml.gather({
            input: ['speech'],
            timeout: 5,  // 5 second timeout
            action: '/webhook/voice?gatherCallback=true',
            method: 'POST',
            language: 'en-US'
        });

        SafeLogger.info('✅ User speech handled successfully');
    }

    private async getCallRuntime(callSid: string): Promise<IAgentRuntime> {
        // Get existing runtime or use default
        let runtime = this.callRuntimes.get(callSid) || this.defaultRuntime;

        if (!runtime) {
            throw new Error('No runtime found for call');
        }

        // Store runtime for this call if not already stored
        if (!this.callRuntimes.has(callSid)) {
            this.callRuntimes.set(callSid, runtime);
        }

        return runtime;
    }

    async handleIncomingCall(req: Request, res: Response) {
        const callSid = req.body.CallSid;
        const twiml = new twilio.twiml.VoiceResponse();

        try {
            // Get or initialize runtime
            const runtime = await this.getCallRuntime(callSid);

            // Handle the call based on input
            const speechResult = req.body.SpeechResult;

            if (speechResult) {
                await this.handleUserSpeech(callSid, speechResult, runtime, twiml);
            } else {
                await this.handleNewCall(callSid, runtime, twiml);
            }

            // Check if call is complete
            if (req.body.CallStatus === 'completed') {
                this.cleanupCall(callSid);
                SafeLogger.info('Call completed, cleaned up resources:', { callSid });
            }

            res.type('text/xml');
            res.send(twiml.toString());

        } catch (error) {
            SafeLogger.error('Error handling incoming call:', error);
            this.cleanupCall(callSid); // Clean up on error
            res.status(500).send('Internal server error');
        }
    }

    private addGatherToTwiml(twiml: twilio.twiml.VoiceResponse) {
        return twiml.gather({
            input: ['speech'],
            timeout: 4,
            action: '/webhook/voice?gatherCallback=true',
            method: 'POST',
            language: 'en-US'
        });
    }

    private sendErrorResponse(res: Response) {
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say("I'm sorry, I encountered an error. Please try again later.");
        twiml.hangup();
        res.type('text/xml').send(twiml.toString());
    }

    async handleOutgoingCall(req: Request, res: Response) {
        const callSid = req.body.CallSid;
        const topic = req.query.topic as string | undefined;
        const twiml = new twilio.twiml.VoiceResponse();

        try {
            const runtime = await this.getCallRuntime(callSid);
            await this.handleNewCall(callSid, runtime, twiml, topic);

            // Check call status
            if (req.body.CallStatus === 'completed' || req.body.CallStatus === 'failed') {
                this.cleanupCall(callSid);
                SafeLogger.info('Outgoing call ended, cleaned up resources:', {
                    callSid,
                    status: req.body.CallStatus
                });
            }

            res.type('text/xml');
            res.send(twiml.toString());

        } catch (error) {
            SafeLogger.error('Error handling outgoing call:', error);
            this.cleanupCall(callSid); // Clean up on error
            res.status(500).send('Internal server error');
        }
    }

    async initiateCall(to: string, message: string, runtime: IAgentRuntime, topic?: string): Promise<string> {
        try {
            SafeLogger.info('📞 Initiating outgoing call:', { to, topic });

            // Extract topic from message if provided
            const extractedTopic = topic || message;

            const voiceSettings = this.convertVoiceSettings(runtime.character?.settings?.voice?.elevenlabs);
            const audioBuffer = await this.tts.convertToSpeech(message, voiceSettings);
            const audioId = audioHandler.addAudio(audioBuffer);

            if (!process.env.TWILIO_PHONE_NUMBER) {
                throw new Error('TWILIO_PHONE_NUMBER not set in environment');
            }

            // Pass topic in the URL for the webhook
            const call = await this.twilio.client.calls.create({
                to,
                from: process.env.TWILIO_PHONE_NUMBER,
                url: `${process.env.WEBHOOK_BASE_URL}/webhook/voice/outgoing?audioId=${audioId}&topic=${encodeURIComponent(extractedTopic)}`
            });

            // Store runtime for this call
            this.callRuntimes.set(call.sid, runtime);

            // Store runtime and initialize conversation
            this.memory.createConversation(call.sid, runtime.character?.name || 'AI Assistant');
            this.memory.addMessage(call.sid, 'assistant', message);

            SafeLogger.info('✅ Outgoing call initiated:', { callSid: call.sid });
            return call.sid;

        } catch (error) {
            SafeLogger.error('Failed to initiate outgoing call:', error);
            throw error;
        }
    }

    // Clean up runtime when call ends
    private cleanupCall(callSid: string) {
        this.callRuntimes.delete(callSid);
        this.memory.clearConversation(callSid);
    }
}

// Create and export the handler instance
const tts = new TextToSpeechService(elevenLabsService);
const memory = new ConversationMemory();
export const voiceHandler = new VoiceHandler(tts, memory, twilioService);