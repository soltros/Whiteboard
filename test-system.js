#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

async function test() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteboard-system-test-'));
  const dataDir = path.join(root, 'data');
  const systemDir = path.join(dataDir, '_system');
  const adminDir = path.join(dataDir, 'admin');

  try {
    await fs.mkdir(systemDir, { recursive: true });
    await fs.mkdir(path.join(adminDir, 'notes'), { recursive: true });
    await fs.writeFile(path.join(systemDir, 'users-index.json'), JSON.stringify({ users: ['admin'] }));
    await fs.writeFile(path.join(adminDir, 'database.json'), JSON.stringify({ notes: {} }));

    const index = JSON.parse(await fs.readFile(path.join(systemDir, 'users-index.json'), 'utf8'));
    if (!Array.isArray(index.users) || !index.users.includes('admin')) throw new Error('users index validation failed');

    const db = JSON.parse(await fs.readFile(path.join(adminDir, 'database.json'), 'utf8'));
    if (!db.notes || typeof db.notes !== 'object') throw new Error('database validation failed');

    await fs.access(path.join(adminDir, 'notes'));
    console.log('✓ Database layout fixture is valid');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test().catch(error => {
  console.error('✗ System test failed:', error);
  process.exit(1);
});
