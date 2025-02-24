import type { ElevenLabsAPI, VoiceSettings } from '../../types/voice.js';
import { SafeLogger } from '../../utils/logger.js';

export class TextToSpeechService {
    constructor(private elevenlabs: ElevenLabsAPI) {}

    async convertToSpeech(text: string, voiceSettings?: Partial<VoiceSettings>): Promise<Buffer> {
        const maxRetries = 3;
        let attempt = 0;

        while (attempt < maxRetries) {
            try {
                const audioBuffer = await Promise.race([
                    this.elevenlabs.textToSpeech(text, voiceSettings),
                    new Promise<Buffer>((_, reject) =>
                        setTimeout(() => reject(new Error('TTS timeout')), 10000)
                    )
                ]);

                if (!audioBuffer) {
                    throw new Error('Empty audio buffer received');
                }

                return audioBuffer;

            } catch (error) {
                attempt++;
                if (attempt === maxRetries) {
                    SafeLogger.error(`TTS conversion failed after ${attempt} attempts:`, error);
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }

        // This should never be reached due to the throw in the if block above
        throw new Error('Failed to convert text to speech after all retries');
    }
}