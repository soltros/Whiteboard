#!/usr/bin/env node

/**
 * Migration Script: Convert legacy note.json files to split format
 *
 * This script finds all legacy note.json files and converts them to:
 * - metadata.json (contains title, tags, password, sharing info, timestamps)
 * - content.md (contains the markdown content)
 *
 * Usage:
 *   node migrate-notes.js           # Dry run - shows what would be migrated
 *   node migrate-notes.js --execute # Actually performs the migration
 *   node migrate-notes.js --execute --remove-old  # Migrate and remove old files
 */

const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// Parse command line arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');
const removeOld = args.includes('--remove-old');

async function findLegacyNotes() {
  const legacyNotes = [];

  try {
    const userDirs = await fs.readdir(DATA_DIR, { withFileTypes: true });

    for (const userDir of userDirs) {
      if (!userDir.isDirectory()) continue;

      const userId = userDir.name;
      const userPath = path.join(DATA_DIR, userId);
      const noteDirs = await fs.readdir(userPath, { withFileTypes: true });

      for (const noteDir of noteDirs) {
        if (!noteDir.isDirectory()) continue;

        const noteId = noteDir.name;
        const notePath = path.join(userPath, noteId);
        const legacyFilePath = path.join(notePath, 'note.json');

        try {
          await fs.access(legacyFilePath);
          legacyNotes.push({
            userId,
            noteId,
            notePath,
            legacyFilePath
          });
        } catch {
          // No legacy file, skip
        }
      }
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No data directory found.');
      return [];
    }
    throw error;
  }

  return legacyNotes;
}

async function migrateNote(noteInfo) {
  const { userId, noteId, notePath, legacyFilePath } = noteInfo;

  try {
    // Read the legacy file
    const legacyContent = await fs.readFile(legacyFilePath, 'utf-8');
    const legacyData = JSON.parse(legacyContent);

    // Extract markdown content
    const markdown = legacyData.markdown || '';

    // Create metadata object (everything except markdown)
    const { markdown: _, ...metadata } = legacyData;

    // Define new file paths
    const metadataPath = path.join(notePath, 'metadata.json');
    const contentPath = path.join(notePath, 'content.md');

    if (dryRun) {
      console.log(`  Would migrate: ${userId}/${noteId}`);
      console.log(`    Title: ${metadata.title || 'Untitled'}`);
      console.log(`    Content length: ${markdown.length} characters`);
      console.log(`    Would create: metadata.json, content.md`);
      if (removeOld) {
        console.log(`    Would remove: note.json`);
      }
      return { success: true, dryRun: true };
    }

    // Write the new files
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    await fs.writeFile(contentPath, markdown);

    console.log(`  ✓ Migrated: ${userId}/${noteId} - "${metadata.title || 'Untitled'}"`);

    // Optionally remove the old file
    if (removeOld) {
      await fs.unlink(legacyFilePath);
      console.log(`    ✓ Removed old note.json`);
    } else {
      console.log(`    ℹ Kept old note.json (use --remove-old to delete)`);
    }

    return { success: true, noteId };
  } catch (error) {
    console.error(`  ✗ Error migrating ${userId}/${noteId}:`, error.message);
    return { success: false, noteId, error: error.message };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('Note Migration Tool: Legacy JSON to Split Format');
  console.log('='.repeat(70));
  console.log();

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No files will be modified');
    console.log('   Use --execute to perform actual migration');
    console.log();
  } else {
    console.log('⚠️  EXECUTE MODE - Files will be modified!');
    if (removeOld) {
      console.log('⚠️  OLD FILES WILL BE DELETED (--remove-old flag active)');
    }
    console.log();
  }

  console.log('Scanning for legacy notes...');
  const legacyNotes = await findLegacyNotes();

  if (legacyNotes.length === 0) {
    console.log('✓ No legacy notes found. All notes are already in the new format!');
    console.log();
    return;
  }

  console.log(`Found ${legacyNotes.length} legacy note(s) to migrate:`);
  console.log();

  const results = {
    total: legacyNotes.length,
    success: 0,
    failed: 0
  };

  for (const noteInfo of legacyNotes) {
    const result = await migrateNote(noteInfo);
    if (result.success) {
      results.success++;
    } else {
      results.failed++;
    }
  }

  console.log();
  console.log('='.repeat(70));
  console.log('Migration Summary:');
  console.log(`  Total notes: ${results.total}`);
  console.log(`  Successful: ${results.success}`);
  console.log(`  Failed: ${results.failed}`);

  if (dryRun) {
    console.log();
    console.log('This was a DRY RUN. To perform the migration, run:');
    console.log('  node migrate-notes.js --execute');
    console.log();
    console.log('To migrate and remove old files:');
    console.log('  node migrate-notes.js --execute --remove-old');
  } else {
    console.log();
    console.log('✓ Migration complete!');
  }
  console.log('='.repeat(70));
}

// Run the migration
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
