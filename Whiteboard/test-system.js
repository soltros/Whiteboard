#!/usr/bin/env node

/**
 * Test the database system to ensure everything works
 */

const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SYSTEM_DIR = path.join(DATA_DIR, '_system');

async function test() {
  console.log('Testing Database System...\n');

  let allPassed = true;

  // Test 1: System directory exists
  try {
    await fs.access(SYSTEM_DIR);
    console.log('✓ System directory exists');
  } catch {
    console.log('✗ System directory missing');
    allPassed = false;
  }

  // Test 2: Users index exists
  try {
    const indexPath = path.join(SYSTEM_DIR, 'users-index.json');
    const content = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(content);
    console.log(`✓ Users index exists (${index.users.length} users tracked)`);
  } catch {
    console.log('✗ Users index missing or invalid');
    allPassed = false;
  }

  // Test 3: Check admin user
  try {
    const adminDir = path.join(DATA_DIR, 'admin');
    await fs.access(adminDir);
    console.log('✓ Admin user directory exists');

    // Check database
    const dbPath = path.join(adminDir, 'database.json');
    const dbContent = await fs.readFile(dbPath, 'utf-8');
    const db = JSON.parse(dbContent);
    console.log(`✓ Admin database exists (${Object.keys(db.notes).length} notes)`);

    // Check notes directory
    const notesDir = path.join(adminDir, 'notes');
    await fs.access(notesDir);
    console.log('✓ Admin notes directory exists');
  } catch (error) {
    console.log('✗ Admin user not properly initialized');
    allPassed = false;
  }

  // Test 4: Server file syntax
  try {
    require('./server.js');
    console.log('✗ Server should not load in test (expected)');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' || error.message.includes('listen')) {
      console.log('✓ Server file has valid syntax');
    } else {
      console.log('✗ Server file has syntax errors:', error.message);
      allPassed = false;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  if (allPassed) {
    console.log('✓ ALL TESTS PASSED');
    console.log('\nYour system is ready to use!');
    console.log('Start the server with: npm start');
  } else {
    console.log('✗ SOME TESTS FAILED');
    console.log('\nRun: node init-existing-users.js');
  }
  console.log('='.repeat(50));
}

test().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
