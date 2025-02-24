// utils/voiceSettingsParser.ts
import type { IAgentRuntime } from '@elizaos/core';

export function parseVoiceSettings(runtime: IAgentRuntime) {
    const voiceId = runtime.character?.settings?.voice?.elevenlabs?.voiceId ??
        (() => { throw new Error('Voice ID is required for ElevenLabs TTS') })();

    const modelId = runtime.character?.settings?.voice?.elevenlabs?.model ??
        process.env.ELEVENLABS_DEFAULT_MODEL ?? 'eleven_multilingual_v2';

    return {
        voiceId,
        modelId,
        stability: Number(runtime.character?.settings?.voice?.elevenlabs?.stability) || 0.5,
        similarityBoost: Number(runtime.character?.settings?.voice?.elevenlabs?.similarityBoost) || 0.8,
        style: Number(runtime.character?.settings?.voice?.elevenlabs?.style) || 0.5,
        useSpeakerBoost: Boolean(runtime.character?.settings?.voice?.elevenlabs?.useSpeakerBoost) || false
    };
}