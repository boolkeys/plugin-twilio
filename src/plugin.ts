import { Plugin } from '@elizaos/core';
import { webhookService } from './services/webhook.js';
import { twilioService } from './services/twilio.js';
import { call } from './actions/call.js';
import { sms } from './actions/sms.js';
import { SafeLogger } from './utils/logger.js';

const plugin: Plugin = {
    name: '@elizaos/plugin-twilio',
    description: 'Twilio integration for voice and SMS interactions',
    actions: [call, sms],
    evaluators: [],
    providers: [],
    services: [webhookService]
};

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

async function initializeWithRetry(
    service: { init: () => Promise<void> },
    serviceName: string
): Promise<void> {
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            await service.init();
            return;
        } catch (error) {
            if (i === MAX_RETRIES - 1) throw error;
            SafeLogger.warn(`Retrying ${serviceName} initialization in ${RETRY_DELAY}ms`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
    }
}

// Initialize services when plugin is loaded
(async () => {
    try {
        // Initialize webhook service first
        await initializeWithRetry(webhookService, 'webhook');
        SafeLogger.info('✅ Webhook service initialized');

        // Check if Twilio is initialized
        if (!twilioService.isInitialized()) {
            SafeLogger.error('Failed to initialize Twilio service - check your credentials');
            return;
        }

        // Setup health checks
        setInterval(() => {
            const health = {
                webhook: webhookService.isHealthy(),
                twilio: twilioService.isHealthy()
            };
            SafeLogger.debug('Service health status:', health);
        }, 60000); // Check every 60 seconds

        SafeLogger.info('Available actions:', [call.name, sms.name]);
        SafeLogger.info('Plugin initialized with services:', {
            webhook: webhookService.isInitialized(),
            twilio: twilioService.isInitialized()
        });

    } catch (error) {
        SafeLogger.error('Error initializing Twilio plugin:', error);
    }
})();

export default plugin;