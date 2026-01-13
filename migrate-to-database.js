#!/usr/bin/env node

/**
 * Migration Script: Convert to per-user database architecture
 *
 * This script migrates from the old structure to the new per-user database structure:
 *
 * OLD:
 *   data/username/note-id/metadata.json
 *   data/username/note-id/content.md
 *
 * NEW:
 *   data/username/database.json          (tracks all notes metadata)
 *   data/username/notes/note-id.md       (markdown files)
 *   data/username/notes/media/note-id/   (media files)
 *
 * Usage:
 *   node migrate-to-database.js           # Dry run
 *   node migrate-to-database.js --execute # Actually performs the migration
 */

const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SYSTEM_DIR = path.join(DATA_DIR, '_system');

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

async function migrateUser(userId) {
  const userDir = path.join(DATA_DIR, userId);
  const notesDir = path.join(userDir, 'notes');
  const databasePath = path.join(userDir, 'database.json');

  console.log(`\n  Migrating user: ${userId}`);

  const database = { notes: {} };
  const entries = await fs.readdir(userDir, { withFileTypes: true });

  let noteMigrated = 0;
  let noteSkipped = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'notes') continue;

    const noteId = entry.name;
    const noteDir = path.join(userDir, noteId);

    try {
      // Try to read metadata.json + content.md (split format)
      let metadata = null;
      let markdown = '';

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
        const notePath = path.join(noteDir, 'note.json');
        const noteContent = await fs.readFile(notePath, 'utf-8');
        const noteData = JSON.parse(noteContent);
        markdown = noteData.markdown || '';
        delete noteData.markdown;
        metadata = noteData;
      }

      if (!metadata) {
        console.log(`    ⚠ Skipped ${noteId}: Could not read metadata`);
        noteSkipped++;
        continue;
      }

      // Add to database
      database.notes[noteId] = metadata;

      if (dryRun) {
        console.log(`    Would migrate: ${noteId} - "${metadata.title}"`);
        console.log(`      → database.json (metadata)`);
        console.log(`      → notes/${noteId}.md (${markdown.length} chars)`);

        // Check for media
        const mediaDir = path.join(noteDir, 'media');
        try {
          await fs.access(mediaDir);
          const mediaFiles = await fs.readdir(mediaDir);
          if (mediaFiles.length > 0) {
            console.log(`      → notes/media/${noteId}/ (${mediaFiles.length} files)`);
          }
        } catch (e) {
          // No media
        }
      } else {
        // Create notes directory if it doesn't exist
        await fs.mkdir(notesDir, { recursive: true });

        // Write markdown file
        const newNotePath = path.join(notesDir, `${noteId}.md`);
        await fs.writeFile(newNotePath, markdown);

        // Move media directory if it exists
        const oldMediaDir = path.join(noteDir, 'media');
        const newMediaDir = path.join(notesDir, 'media', noteId);

        try {
          await fs.access(oldMediaDir);
          await fs.mkdir(path.join(notesDir, 'media'), { recursive: true });
          await fs.rename(oldMediaDir, newMediaDir);
          console.log(`    ✓ Migrated ${noteId} with media`);
        } catch (e) {
          console.log(`    ✓ Migrated ${noteId}`);
        }

        // Remove old note directory
        await fs.rm(noteDir, { recursive: true, force: true });
      }

      noteMigrated++;
    } catch (error) {
      console.error(`    ✗ Error migrating ${noteId}:`, error.message);
      noteSkipped++;
    }
  }

  if (!dryRun) {
    // Write database file
    await fs.writeFile(databasePath, JSON.stringify(database, null, 2));
    console.log(`  ✓ Created database.json with ${noteMigrated} notes`);
  }

  return { migrated: noteMigrated, skipped: noteSkipped };
}

async function main() {
  console.log('='.repeat(70));
  console.log('Per-User Database Migration Tool');
  console.log('='.repeat(70));
  console.log();

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be modified');
    console.log('   Use --execute to perform actual migration');
    console.log();
  } else {
    console.log('⚠️  EXECUTE MODE - Files will be migrated!');
    console.log();
  }

  // Ensure system directory exists
  try {
    await fs.access(SYSTEM_DIR);
  } catch {
    await fs.mkdir(SYSTEM_DIR, { recursive: true });
  }

  // Get all user directories
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const users = entries.filter(e => e.isDirectory() && e.name !== '_system').map(e => e.name);

  if (users.length === 0) {
    console.log('✓ No users found to migrate');
    return;
  }

  console.log(`Found ${users.length} user(s) to migrate:`);

  const results = {
    totalUsers: users.length,
    totalNotes: 0,
    totalSkipped: 0
  };

  for (const userId of users) {
    const result = await migrateUser(userId);
    results.totalNotes += result.migrated;
    results.totalSkipped += result.skipped;
  }

  // Create users index
  const usersIndex = { users };
  const usersIndexPath = path.join(SYSTEM_DIR, 'users-index.json');

  if (!dryRun) {
    await fs.writeFile(usersIndexPath, JSON.stringify(usersIndex, null, 2));
    console.log(`\n  ✓ Created system users index`);
  }

  console.log();
  console.log('='.repeat(70));
  console.log('Migration Summary:');
  console.log(`  Users: ${results.totalUsers}`);
  console.log(`  Notes migrated: ${results.totalNotes}`);
  console.log(`  Notes skipped: ${results.totalSkipped}`);

  if (dryRun) {
    console.log();
    console.log('This was a DRY RUN. To perform the migration, run:');
    console.log('  node migrate-to-database.js --execute');
  } else {
    console.log();
    console.log('✓ Migration complete!');
    console.log();
    console.log('New structure:');
    console.log('  data/');
    console.log('    _system/');
    console.log('      users-index.json  (system metadata)');
    console.log('    username/');
    console.log('      database.json     (per-user note index)');
    console.log('      notes/');
    console.log('        note-id.md      (markdown files)');
    console.log('        media/');
    console.log('          note-id/      (media files)');
  }
  console.log('='.repeat(70));
}

// Run the migration
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
