/**
 * Database Backup Script
 *
 * Creates a complete MongoDB dump with timestamp
 *
 * Run with: node scripts/backup-database.js
 */

const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/fantasy-fusion";

function executeCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      if (stderr && !stderr.includes("writing")) {
        console.log(stderr);
      }
      resolve(stdout);
    });
  });
}

async function createBackup() {
  console.log("💾 Database Backup Script");
  console.log("========================\n");
  console.log(`📍 Database: ${MONGODB_URI}\n`);

  try {
    // Check if mongodump is available
    console.log("🔍 Checking if mongodump is installed...");
    try {
      await executeCommand("mongodump --version");
      console.log("✅ mongodump is available\n");
    } catch (error) {
      console.error("❌ mongodump is not installed or not in PATH");
      console.error("\nPlease install MongoDB Database Tools:");
      console.error("https://www.mongodb.com/try/download/database-tools\n");
      process.exit(1);
    }

    // Create backup directory if it doesn't exist
    const backupDir = path.join(__dirname, "..", "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log(`📁 Created backups directory: ${backupDir}\n`);
    }

    // Generate timestamp for backup folder
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T");
    const dateStr = timestamp[0];
    const timeStr = timestamp[1].split("Z")[0];
    const backupName = `backup-${dateStr}-${timeStr}`;
    const backupPath = path.join(backupDir, backupName);

    console.log(`📦 Creating backup: ${backupName}\n`);
    console.log("⏳ This may take a few moments...\n");

    // Run mongodump
    const dumpCommand = `mongodump --uri="${MONGODB_URI}" --out="${backupPath}"`;

    const startTime = Date.now();
    await executeCommand(dumpCommand);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    // Get backup size
    const getSize = (dirPath) => {
      let size = 0;
      const files = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const file of files) {
        const filePath = path.join(dirPath, file.name);
        if (file.isDirectory()) {
          size += getSize(filePath);
        } else {
          size += fs.statSync(filePath).size;
        }
      }
      return size;
    };

    const backupSize = getSize(backupPath);
    const sizeMB = (backupSize / (1024 * 1024)).toFixed(2);

    console.log("✅ Backup completed successfully!\n");
    console.log("📊 Backup Details:");
    console.log(`  Location: ${backupPath}`);
    console.log(`  Size: ${sizeMB} MB`);
    console.log(`  Duration: ${duration}s\n`);

    // List collections backed up
    const dbName = MONGODB_URI.split("/").pop().split("?")[0];
    const dbPath = path.join(backupPath, dbName);

    if (fs.existsSync(dbPath)) {
      const collections = fs
        .readdirSync(dbPath)
        .filter((f) => f.endsWith(".bson"))
        .map((f) => f.replace(".bson", ""));

      console.log("📚 Collections backed up:");
      collections.forEach((col) => {
        const stats = fs.statSync(path.join(dbPath, `${col}.bson`));
        const colSizeKB = (stats.size / 1024).toFixed(2);
        console.log(`  - ${col} (${colSizeKB} KB)`);
      });
      console.log("");
    }

    console.log("💡 To restore this backup, run:");
    console.log(`   mongorestore --uri="${MONGODB_URI}" --drop "${backupPath}"\n`);

    // Clean up old backups (keep last 5)
    console.log("🧹 Checking for old backups...");
    const allBackups = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith("backup-"))
      .map((f) => ({
        name: f,
        path: path.join(backupDir, f),
        time: fs.statSync(path.join(backupDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    if (allBackups.length > 5) {
      console.log(`📦 Found ${allBackups.length} backups, keeping 5 most recent...\n`);
      const toDelete = allBackups.slice(5);

      for (const backup of toDelete) {
        console.log(`🗑️  Deleting old backup: ${backup.name}`);
        fs.rmSync(backup.path, { recursive: true, force: true });
      }
      console.log(`✅ Cleaned up ${toDelete.length} old backup(s)\n`);
    } else {
      console.log(`✅ Backup count OK (${allBackups.length}/5)\n`);
    }

    // Return backup info for use in other scripts
    return {
      success: true,
      path: backupPath,
      name: backupName,
      size: sizeMB,
      duration: duration,
      collections: fs.existsSync(dbPath) ? fs.readdirSync(dbPath).filter((f) => f.endsWith(".bson")).length : 0,
    };
  } catch (error) {
    console.error("❌ Backup failed:", error.message);
    console.error("\nFull error:", error);
    process.exit(1);
  }
}

// Export for use in other scripts
module.exports = { createBackup };

// Run directly if called as script
if (require.main === module) {
  createBackup()
    .then(() => {
      console.log("🎉 Backup process completed!\n");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Backup process failed:", error);
      process.exit(1);
    });
}
