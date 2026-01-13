#!/usr/bin/env node

/**
 * Initialize databases for existing users
 *
 * This script creates database.json files for users who already exist
 * but don't have the new database structure yet.
 *
 * Safe to run multiple times - won't overwrite existing databases.
 */

const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SYSTEM_DIR = path.join(DATA_DIR, '_system');
const USERS_INDEX_FILE = path.join(SYSTEM_DIR, 'users-index.json');

async function initializeUserDatabase(userId) {
  const userDir = path.join(DATA_DIR, userId);
  const databasePath = path.join(userDir, 'database.json');
  const notesDir = path.join(userDir, 'notes');

  console.log(`\n  Processing user: ${userId}`);

  // Check if database already exists
  try {
    await fs.access(databasePath);
    console.log(`    ✓ Database already exists, skipping`);
    return { status: 'exists', noteCount: 0 };
  } catch {
    // Database doesn't exist, create it
  }

  // Ensure notes directory exists
  try {
    await fs.access(notesDir);
  } catch {
    await fs.mkdir(notesDir, { recursive: true });
  }

  // Scan for existing notes (old format)
  const database = { notes: {} };
  let noteCount = 0;

  try {
    const entries = await fs.readdir(userDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'notes') continue;

      const noteId = entry.name;
      const noteDir = path.join(userDir, noteId);

      try {
        // Try to read old format note
        let metadata = null;
        let markdown = '';

        // Try split format (metadata.json + content.md)
        try {
          const metaPath = path.join(noteDir, 'metadata.json');
          const contentPath = path.join(noteDir, 'content.md');

          const metaContent = await fs.readFile(metaPath, 'utf-8');
          metadata = JSON.parse(metaContent);

          try {
            markdown = await fs.readFile(contentPath, 'utf-8');
          } catch (e) {
            // Content file might not exist
          }
        } catch (e) {
          // Try old note.json format
          try {
            const notePath = path.join(noteDir, 'note.json');
            const noteContent = await fs.readFile(notePath, 'utf-8');
            const noteData = JSON.parse(noteContent);
            markdown = noteData.markdown || '';
            delete noteData.markdown;
            metadata = noteData;
          } catch (e2) {
            console.log(`      ⚠ Skipped ${noteId}: Could not read note data`);
            continue;
          }
        }

        if (metadata) {
          // Add to database
          database.notes[noteId] = metadata;

          // Write markdown file to new location
          const newNotePath = path.join(notesDir, `${noteId}.md`);
          await fs.writeFile(newNotePath, markdown);

          // Move media if it exists
          const oldMediaDir = path.join(noteDir, 'media');
          const newMediaDir = path.join(notesDir, 'media', noteId);

          try {
            await fs.access(oldMediaDir);
            await fs.mkdir(path.join(notesDir, 'media'), { recursive: true });
            await fs.rename(oldMediaDir, newMediaDir);
          } catch (e) {
            // No media to move
          }

          noteCount++;
          console.log(`      ✓ Migrated note: ${metadata.title || noteId}`);
        }
      } catch (error) {
        console.error(`      ✗ Error processing ${noteId}:`, error.message);
      }
    }

    // Create the database file
    await fs.writeFile(databasePath, JSON.stringify(database, null, 2));
    console.log(`    ✓ Created database.json with ${noteCount} notes`);

    return { status: 'created', noteCount };
  } catch (error) {
    console.error(`    ✗ Error initializing user ${userId}:`, error.message);
    return { status: 'error', noteCount: 0 };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('Initialize Databases for Existing Users');
  console.log('='.repeat(70));
  console.log();

  // Ensure system directory exists
  try {
    await fs.access(SYSTEM_DIR);
  } catch {
    await fs.mkdir(SYSTEM_DIR, { recursive: true });
    console.log('Created _system directory');
  }

  // Get all existing user directories
  try {
    await fs.access(DATA_DIR);
  } catch {
    console.log('No data directory found. No users to initialize.');
    return;
  }

  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const users = entries
    .filter(e => e.isDirectory() && e.name !== '_system')
    .map(e => e.name);

  if (users.length === 0) {
    console.log('No users found in data directory.');
    return;
  }

  console.log(`Found ${users.length} user(s):\n`);

  const results = {
    total: users.length,
    created: 0,
    exists: 0,
    errors: 0,
    totalNotes: 0
  };

  // Process each user
  for (const userId of users) {
    const result = await initializeUserDatabase(userId);

    if (result.status === 'created') {
      results.created++;
      results.totalNotes += result.noteCount;
    } else if (result.status === 'exists') {
      results.exists++;
    } else {
      results.errors++;
    }
  }

  // Create or update users index
  const usersIndex = { users };
  try {
    await fs.writeFile(USERS_INDEX_FILE, JSON.stringify(usersIndex, null, 2));
    console.log(`\n  ✓ Updated system users index`);
  } catch (error) {
    console.error(`\n  ✗ Error creating users index:`, error.message);
  }

  // Summary
  console.log();
  console.log('='.repeat(70));
  console.log('Summary:');
  console.log(`  Total users: ${results.total}`);
  console.log(`  Databases created: ${results.created}`);
  console.log(`  Already existed: ${results.exists}`);
  console.log(`  Errors: ${results.errors}`);
  console.log(`  Total notes migrated: ${results.totalNotes}`);
  console.log();
  console.log('✓ Initialization complete!');
  console.log();
  console.log('Your system is now ready to use the new database architecture.');
  console.log('All existing users have their databases initialized.');
  console.log('New users will automatically get databases when created.');
  console.log('='.repeat(70));
}

// Run initialization
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
