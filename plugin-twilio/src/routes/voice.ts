import express, { Router, Request, Response, NextFunction } from 'express';
import { voiceHandler } from '../services/voice/handler.js';
import { SafeLogger } from '../utils/logger.js';
import { validateRequest } from 'twilio/lib/webhooks/webhooks.js';
import rateLimit from 'express-rate-limit';
import type { VoiceConversationMemory } from '../types/voice.js';

const router: Router = express.Router();

// Configure rate limiters
const incomingCallLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // More lenient for incoming calls
    message: 'Too many incoming calls, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

const outgoingCallLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Stricter for outgoing calls
    message: 'Too many outgoing calls, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

// Add webhook validation middleware
const validateWebhook = (req: Request, res: Response, next: NextFunction) => {
    if (!process.env.TWILIO_AUTH_TOKEN) {
        SafeLogger.error('TWILIO_AUTH_TOKEN not set in environment');
        return res.status(500).send('Server configuration error');
    }

    const twilioSignature = req.headers['x-twilio-signature'];
    if (!twilioSignature) {
        SafeLogger.warn('Missing Twilio signature');
        return res.status(403).send('Missing signature');
    }

    const url = req.protocol + '://' + req.get('host') + req.originalUrl;

    try {
        if (!validateRequest(
            process.env.TWILIO_AUTH_TOKEN,
            twilioSignature as string,
            url,
            req.body
        )) {
            SafeLogger.warn('Invalid Twilio signature');
            return res.status(403).send('Invalid signature');
        }
        next();
    } catch (error) {
        SafeLogger.error('Webhook validation error:', error);
        return res.status(403).send('Validation error');
    }
};

// Apply validation and rate limiting to voice webhook routes
router.post('/webhook/voice',
    incomingCallLimiter,
    validateWebhook,
    (req, res) => voiceHandler.handleIncomingCall(req, res)
);

router.post('/webhook/voice/outgoing',
    outgoingCallLimiter,
    validateWebhook,
    (req, res) => voiceHandler.handleOutgoingCall(req, res)
);

export default router;