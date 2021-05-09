import { TTSConfig } from './config_def.js';
import AWS from '@aws-sdk/client-polly';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const ttsCache = path.join(process.cwd(), 'tts_cache');

const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);

function cacheOrCreateFactory(factory: (text: string) => Promise<Readable>): (text: string) => Promise<Readable> {
  return async (text: string) => {
    const cachePath = path.join(ttsCache, text);
    try {
      await stat(cachePath);

      return fs.createReadStream(cachePath);
    } catch (e) {
      const cacheStream = fs.createWriteStream(cachePath);
      const stream = await factory(text);

      stream.pipe(cacheStream);

      return new Promise((resolve) => stream.on('close', () => resolve(fs.createReadStream(cachePath))));
    }
  };
}

export default async function initTTS(config: TTSConfig) {
  await mkdir(ttsCache, { recursive: true });
  switch (config.type) {
    case 'aws-polly': {
      const client = new AWS.Polly({
        region: config.region,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey
        }
      });
      const VoiceId = config.voiceId;
      return cacheOrCreateFactory(async (text: string) => {
        const resp = await client.synthesizeSpeech({
          Text: text,
          OutputFormat: 'ogg_vorbis',
          VoiceId
        });

        return resp.AudioStream as Readable;
      });
    }
    default:
      return undefined;
  }
}
