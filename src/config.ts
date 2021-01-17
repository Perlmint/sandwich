import { readFile } from 'fs';
import path from 'path';

import { Config } from './config_def.js';
export * from './config_def.js';

const config: Config = await new Promise((resolve, reject) => {
  readFile(path.join(process.cwd(), 'config', 'default.json'), { encoding: 'utf-8' }, (e, d) => {
    if (e == null) {
      resolve(JSON.parse(d));
    } else {
      reject(e);
    }
  });
});

export default config;
