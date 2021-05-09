import { readFile } from 'fs/promises';
import path from 'path';
import { validate } from 'jsonschema';

import { Config } from './config_def.js';
export * from './config_def.js';

const isProduction = process.env.NODE_ENV === 'production';

const config: Config = await Promise.all([
  readFile(path.join(process.cwd(), 'config_schema.json'), { encoding: 'utf-8' }).catch((e) => {
    if (isProduction) {
      throw e;
    } else {
      return null;
    }
  }),
  readFile(path.join(process.cwd(), 'config', 'default.json'), { encoding: 'utf-8' })
]).then(([rawSchema, rawConfig]) => {
  const config = JSON.parse(rawConfig);

  if (isProduction) {
    const schema = JSON.parse(rawSchema!);

    const validationResult = validate(config, schema);
    if (!validationResult.valid) {
      throw new Error(validationResult.toString());
    }
  }

  return config;
});

export default config;
