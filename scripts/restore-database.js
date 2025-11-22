/**
 * Database Restore Script
 *
 * Restores a MongoDB backup from the backups directory
 *
 * Run with: node scripts/restore-database.js [backup-folder-name]
 * Example: node scripts/restore-database.js backup-2024-01-15-14-30-00
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fantasy-fusion';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

function executeCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      if (stderr && !stderr.includes('done')) {
        console.log(stderr);
      }
      resolve(stdout);
    });
  });
}

async function listBackups() {
  const backupDir = path.join(__dirname, '..', 'backups');

  if (!fs.existsSync(backupDir)) {
    console.log('❌ No backups directory found.');
    return [];
  }

  const backups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('backup-'))
    .map(f => {
      const fullPath = path.join(backupDir, f);
      const stats = fs.statSync(fullPath);
      return {
        name: f,
        path: fullPath,
        date: stats.mtime,
        size: (stats.size / (1024 * 1024)).toFixed(2)
      };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  return backups;
}

async function restoreBackup(backupPath) {
  console.log('🔄 Database Restore Script');
  console.log('==========================\n');
  console.log(`📍 Database: ${MONGODB_URI}`);
  console.log(`📦 Backup: ${path.basename(backupPath)}\n`);

  console.log('⚠️  WARNING: This will DROP all existing data and replace it with the backup!');
  console.log('⚠️  All current data in the database will be PERMANENTLY DELETED!\n');

  const confirm1 = await question('Are you absolutely sure you want to restore? (yes/no): ');

  if (confirm1.toLowerCase() !== 'yes') {
    console.log('\n❌ Restore cancelled.');
    rl.close();
    process.exit(0);
  }

  const confirm2 = await question('\nType "RESTORE" in capital letters to confirm: ');

  if (confirm2 !== 'RESTORE') {
    console.log('\n❌ Restore cancelled - confirmation did not match.');
    rl.close();
    process.exit(0);
  }

  try {
    // Check if mongorestore is available
    console.log('\n🔍 Checking if mongorestore is installed...');
    try {
      await executeCommand('mongorestore --version');
      console.log('✅ mongorestore is available\n');
    } catch (error) {
      console.error('❌ mongorestore is not installed or not in PATH');
      console.error('\nPlease install MongoDB Database Tools:');
      console.error('https://www.mongodb.com/try/download/database-tools\n');
      rl.close();
      process.exit(1);
    }

    console.log('🔄 Starting restore...\n');
    console.log('⏳ This may take a few moments...\n');

    const restoreCommand = `mongorestore --uri="${MONGODB_URI}" --drop "${backupPath}"`;

    const startTime = Date.now();
    await executeCommand(restoreCommand);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`✅ Restore completed in ${duration}s!\n`);
    console.log('📊 Database has been restored from backup.\n');
    console.log('💡 Please verify your application is working correctly.\n');

    rl.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Restore failed:', error.message);
    console.error('\nFull error:', error);
    rl.close();
    process.exit(1);
  }
}

async function run() {
  const backupName = process.argv[2];

  if (backupName) {
    // Restore specific backup
    const backupPath = path.join(__dirname, '..', 'backups', backupName);

    if (!fs.existsSync(backupPath)) {
      console.error(`❌ Backup not found: ${backupName}\n`);
      console.log('📦 Available backups:\n');
      const backups = await listBackups();
      if (backups.length === 0) {
        console.log('  (no backups found)\n');
      } else {
        backups.forEach((backup, idx) => {
          console.log(`  ${idx + 1}. ${backup.name}`);
          console.log(`     Created: ${backup.date.toLocaleString()}`);
          console.log(`     Size: ${backup.size} MB\n`);
        });
      }
      process.exit(1);
    }

    await restoreBackup(backupPath);
  } else {
    // Interactive mode - list backups and let user choose
    console.log('🔄 Database Restore Script');
    console.log('==========================\n');

    const backups = await listBackups();

    if (backups.length === 0) {
      console.log('❌ No backups found in backups directory.\n');
      console.log('Run a backup first with: npm run db:backup\n');
      rl.close();
      process.exit(1);
    }

    console.log('📦 Available backups:\n');
    backups.forEach((backup, idx) => {
      console.log(`  ${idx + 1}. ${backup.name}`);
      console.log(`     Created: ${backup.date.toLocaleString()}`);
      console.log(`     Size: ${backup.size} MB\n`);
    });

    const choice = await question('Enter backup number to restore (or "cancel"): ');

    if (choice.toLowerCase() === 'cancel') {
      console.log('\n❌ Restore cancelled.');
      rl.close();
      process.exit(0);
    }

    const selectedIdx = parseInt(choice) - 1;

    if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= backups.length) {
      console.log('\n❌ Invalid selection.');
      rl.close();
      process.exit(1);
    }

    await restoreBackup(backups[selectedIdx].path);
  }
}

run().catch(error => {
  console.error('💥 Restore process failed:', error);
  rl.close();
  process.exit(1);
});

