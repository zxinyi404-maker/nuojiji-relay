import { createRequire } from 'node:module';
import { subKey } from './subStore.js';

export class SqliteSubStore {
    constructor(path = './outbox.db') {
        const require = createRequire(import.meta.url);
        const Database = require(['better', 'sqlite3'].join('-'));
        this.kind = 'sqlite';
        this.db = new Database(path);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                inboxId TEXT NOT NULL,
                subKey TEXT NOT NULL,
                channel TEXT NOT NULL,
                data TEXT NOT NULL,
                PRIMARY KEY (inboxId, subKey)
            );
        `);
    }

    async add(inboxId, subscription) {
        const channel = subscription?.channel || subscription?.sub?.channel || 'web';
        this.db.prepare('INSERT OR REPLACE INTO push_subscriptions (inboxId, subKey, channel, data) VALUES (?, ?, ?, ?)')
            .run(inboxId, subKey(subscription), channel, JSON.stringify(subscription));
    }

    async list(inboxId) {
        return this.db.prepare('SELECT data FROM push_subscriptions WHERE inboxId = ? ORDER BY rowid')
            .all(inboxId).map(row => JSON.parse(row.data));
    }

    async remove(inboxId, subscription) {
        this.db.prepare('DELETE FROM push_subscriptions WHERE inboxId = ? AND subKey = ?')
            .run(inboxId, subKey(subscription));
    }

    async pruneChannel(inboxId, channel, keepKey) {
        this.db.prepare('DELETE FROM push_subscriptions WHERE inboxId = ? AND channel = ? AND subKey <> ?')
            .run(inboxId, channel, keepKey);
    }
}
