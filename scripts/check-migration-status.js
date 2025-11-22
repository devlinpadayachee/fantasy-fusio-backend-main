/**
 * Migration Check Script: Analyze current data types
 *
 * This script checks the database to see which documents need migration
 * from Number to String for wei values. It does NOT make any changes.
 *
 * Run with: node scripts/check-migration-status.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/fantasy-fusion';

async function checkCollection(collectionName, checks) {
  console.log(`\n📊 Checking ${collectionName}...`);

  const collection = mongoose.connection.collection(collectionName);
  const documents = await collection.find({}).toArray();

  if (documents.length === 0) {
    console.log(`  ℹ️  No documents found`);
    return { total: 0, needsMigration: 0, fields: {} };
  }

  let needsMigration = 0;
  const fieldStats = {};

  for (const field of checks) {
    fieldStats[field] = { numbers: 0, strings: 0, nullOrUndefined: 0 };
  }

  for (const doc of documents) {
    let docNeedsMigration = false;

    for (const field of checks) {
      // Handle nested fields (e.g., "gameOutcome.reward")
      const fieldPath = field.split('.');
      let value = doc;

      for (const part of fieldPath) {
        value = value?.[part];
      }

      if (value === null || value === undefined) {
        fieldStats[field].nullOrUndefined++;
      } else if (typeof value === 'number') {
        fieldStats[field].numbers++;
        docNeedsMigration = true;
      } else if (typeof value === 'string') {
        fieldStats[field].strings++;
      }
    }

    if (docNeedsMigration) {
      needsMigration++;
    }
  }

  console.log(`  Total documents: ${documents.length}`);
  console.log(`  Need migration: ${needsMigration}`);

  for (const field of checks) {
    const stats = fieldStats[field];
    if (stats.numbers > 0 || stats.strings > 0) {
      console.log(`    ${field}:`);
      if (stats.numbers > 0) console.log(`      - Numbers: ${stats.numbers} ⚠️`);
      if (stats.strings > 0) console.log(`      - Strings: ${stats.strings} ✅`);
      if (stats.nullOrUndefined > 0) console.log(`      - Null/Undefined: ${stats.nullOrUndefined}`);
    }
  }

  return { total: documents.length, needsMigration, fields: fieldStats };
}

async function runCheck() {
  console.log('🔍 Database Migration Status Check');
  console.log('==================================\n');
  console.log(`📍 Database: ${MONGODB_URI}\n`);

  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const results = {
      users: await checkCollection('users', [
        'totalEarnings',
        'currentBalance',
        'lockedBalance'
      ]),
      transactions: await checkCollection('transactions', [
        'amount',
        'gasUsed',
        'gasPrice',
        'networkFee'
      ]),
      games: await checkCollection('games', [
        'totalPrizePool'
      ]),
      portfolios: await checkCollection('portfolios', [
        'gameOutcome.reward'
      ]),
    };

    // Summary
    console.log('\n\n📊 Migration Status Summary');
    console.log('===========================\n');

    const collections = [
      { name: 'Users', data: results.users },
      { name: 'Transactions', data: results.transactions },
      { name: 'Games', data: results.games },
      { name: 'Portfolios', data: results.portfolios },
    ];

    let totalDocs = 0;
    let totalNeedsMigration = 0;

    for (const { name, data } of collections) {
      totalDocs += data.total;
      totalNeedsMigration += data.needsMigration;

      const status = data.needsMigration > 0 ? '⚠️' : '✅';
      console.log(`${status} ${name}: ${data.needsMigration}/${data.total} need migration`);
    }

    console.log(`\n📈 Total: ${totalNeedsMigration}/${totalDocs} documents need migration\n`);

    if (totalNeedsMigration > 0) {
      console.log('⚠️  Migration is required!');
      console.log('   Run: node scripts/migrate-wei-to-string.js\n');
      process.exit(0);
    } else {
      console.log('✅ All documents are already migrated!\n');
      process.exit(0);
    }

  } catch (error) {
    console.error('\n❌ Check failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB\n');
  }
}

// Run the check
runCheck();

