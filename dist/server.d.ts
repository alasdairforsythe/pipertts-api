import { type Server } from 'node:http';
import { PiperTTS } from './engine.js';
/** Create (not start) the HTTP server around a loaded engine. */
export declare function createApiServer(tts: PiperTTS): Server;
