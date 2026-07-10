import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { join } from 'path';
import { PROJECT_ROOT } from '../config/paths.js';

const db = new Database(join(PROJECT_ROOT, 'data', 'auth.db'));

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        username          TEXT UNIQUE NOT NULL,
        password_hash     TEXT NOT NULL,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
`);

export interface AuthUser {
    id: number;
    username: string;
    mustChangePassword: boolean;
}

type UserRow = {
    id: number;
    username: string;
    password_hash: string;
    must_change_password: number;
};

export async function initAuthDb(): Promise<void> {
    const { count } = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (count === 0) {
        const hash = await bcrypt.hash('admin', 12);
        db.prepare(
            'INSERT INTO users (username, password_hash, must_change_password) VALUES (?, ?, 1)',
        ).run('admin', hash);
        console.log('Created default admin user (username: admin, password: admin). Change it on first login.');
    }
}

export async function verifyUser(username: string, password: string): Promise<AuthUser | null> {
    const row = db.prepare(
        'SELECT id, username, password_hash, must_change_password FROM users WHERE username = ?',
    ).get(username) as UserRow | undefined;

    if (!row) return null;
    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) return null;

    return {
        id: row.id,
        username: row.username,
        mustChangePassword: row.must_change_password === 1,
    };
}

export async function changePassword(userId: number, newPassword: string): Promise<void> {
    const hash = await bcrypt.hash(newPassword, 12);
    db.prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    ).run(hash, userId);
}

export async function resetAdminPassword(): Promise<void> {
    const hash = await bcrypt.hash('admin', 12);
    db.prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE username = ?',
    ).run(hash, 'admin');
    console.log('Admin password reset to "admin". You will be prompted to change it on next login.');
}
