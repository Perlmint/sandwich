import { validate } from 'jsonschema';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config_schema.json'), { encoding: 'utf-8' }));
const exampleConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'example.json'), { encoding: 'utf-8' }));

const result = validate(exampleConfig, schema);
if (result.valid) {
  console.log('Example config is valid');
} else {
  throw new Error(result.toString());
}
