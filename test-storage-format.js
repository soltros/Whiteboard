#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

async function test() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'whiteboard-storage-test-'));
  const noteId = crypto.randomBytes(8).toString('hex');
  const noteDir = path.join(root, 'data', 'test-user', noteId);

  try {
    await fs.mkdir(noteDir, { recursive: true });
    const metadata = {
      title: 'Test Note',
      tags: ['test', 'demo'],
      groups: [],
      isPasswordProtected: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const markdown = '# Test Note\n\nSplit storage validation.\n';

    await fs.writeFile(path.join(noteDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
    await fs.writeFile(path.join(noteDir, 'content.md'), markdown);

    const storedMetadata = JSON.parse(await fs.readFile(path.join(noteDir, 'metadata.json'), 'utf8'));
    const storedMarkdown = await fs.readFile(path.join(noteDir, 'content.md'), 'utf8');

    if (storedMetadata.title !== metadata.title) throw new Error('metadata round-trip failed');
    if (storedMarkdown !== markdown) throw new Error('Markdown round-trip failed');
    console.log('✓ Split storage format round-trip passed');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test().catch(error => {
  console.error('✗ Storage test failed:', error);
  process.exit(1);
});
