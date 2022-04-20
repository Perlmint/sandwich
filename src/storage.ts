import { Database } from 'sqlite';
import { randomInt, randomUUID } from 'crypto';

interface UserMap {
    protocol: string;
    remote_id: string;
    internal_id: string;
}

export class UserMapStorage {
    private register_keys: Map<string, string> = new Map();

    constructor(private db: Database) {
        db.migrate();
    }

    public async to_internal_id(protocol: string, uid: string) {
        return (await this.db.get<Pick<UserMap, 'internal_id'>>(
            'SELECT internal_id FROM UserMap WHERE protocol = ? AND remote_id = ?',
            protocol,
            uid
        ))?.internal_id;
    }

    public async to_remote_id(protocol: string, internal_id: string) {
        return (await this.db.get<Pick<UserMap, 'remote_id'>>(
            'SELECT remote_id FROM UserMap WHERE protocol = ? AND internal_id = ?',
            protocol,
            internal_id
        ))?.remote_id;
    }

    public async register(protocol: string, remote_id: string, key?: string) {
        if (key == undefined) {
            let internal_id = await this.to_internal_id(protocol, remote_id);
            while (true) {
                internal_id = randomInt(65535).toString(10);
                if (await this.db.get<Pick<UserMap, 'internal_id'>>(
                    'SELECT internal_id FROM UserMap WHERE internal_id = ?',
                    internal_id,
                ) === undefined) {
                    await this.db.exec(
                        'INSERT INTO UserMap VALUES (protocol, remote_id, internal_id) (?, ?, ?)',
                        protocol,
                        remote_id,
                        internal_id,
                    );
                    break;
                }
            }
            
            key = randomUUID();
            while (this.register_keys.get(key) !== undefined) {
                key = randomUUID();
            }

            this.register_keys.set(key, internal_id);
        } else {
            const internal_id = this.register_keys.get(key);
            if (internal_id == undefined) {
                throw new Error(`Unknown register key - ${key}`);
            } else {
                await this.db.exec(
                    'INSERT INTO UserMap VALUES (protocol, remote_id, internal_id) (?, ?, ?)',
                    protocol,
                    remote_id,
                    internal_id,
                );
            }
        }
            
        return key;
    }
};
