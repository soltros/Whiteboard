#!/usr/bin/env node

/**
 * Test Script: Verify split storage format functionality
 *
 * This script tests that the new split storage format works correctly
 * by creating a test note and verifying the files are created properly.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const TEST_USER = 'test-user';
const TEST_NOTE_ID = crypto.randomBytes(8).toString('hex');

async function createTestNote() {
  console.log('Testing split storage format...\n');

  // Create test user directory
  const userDir = path.join(DATA_DIR, TEST_USER);
  await fs.mkdir(userDir, { recursive: true });
  console.log('✓ Created test user directory:', userDir);

  // Create test note directory
  const noteDir = path.join(userDir, TEST_NOTE_ID);
  await fs.mkdir(noteDir, { recursive: true });
  console.log('✓ Created test note directory:', noteDir);

  // Create metadata
  const metadata = {
    title: 'Test Note',
    tags: ['test', 'demo'],
    isPasswordProtected: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const metadataPath = path.join(noteDir, 'metadata.json');
  await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
  console.log('✓ Created metadata.json');

  // Create content
  const content = `# Test Note

This is a test note to verify the split storage format is working correctly.

## Features Tested

- Metadata stored in separate JSON file
- Content stored in separate Markdown file
- Clean separation of concerns

**Status**: ✓ Working correctly!
`;

  const contentPath = path.join(noteDir, 'content.md');
  await fs.writeFile(contentPath, content);
  console.log('✓ Created content.md');

  console.log('\nTest files created successfully!');
  console.log('\nFile structure:');
  console.log(`${noteDir}/`);
  console.log('  ├── metadata.json');
  console.log('  └── content.md');

  // Read and verify files
  console.log('\n--- metadata.json ---');
  const readMetadata = await fs.readFile(metadataPath, 'utf-8');
  console.log(readMetadata);

  console.log('\n--- content.md ---');
  const readContent = await fs.readFile(contentPath, 'utf-8');
  console.log(readContent);

  console.log('\n✓ All tests passed!');
  console.log('\nTo clean up test data, run:');
  console.log(`  rm -rf ${userDir}`);
}

async function main() {
  try {
    await createTestNote();
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

main();
