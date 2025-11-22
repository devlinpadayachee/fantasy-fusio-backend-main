/**
 * Rollback Script: Convert Wei Values from String back to Number
 *
 * ⚠️  WARNING: This will cause precision loss for large wei values!
 * Only use this if you need to rollback the migration.
 *
 * Run with: node scripts/rollback-wei-migration.js
 */

const mongoose = require('mongoose');
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

async function rollbackUsers() {
  console.log('\n📊 Rolling back Users collection...');

  const collection = mongoose.connection.collection('users');
  const users = await collection.find({}).toArray();
  let updated = 0;

  for (const user of users) {
    const updates = {};

    if (typeof user.totalEarnings === 'string') {
      updates.totalEarnings = parseFloat(user.totalEarnings) || 0;
    }

    if (typeof user.currentBalance === 'string') {
      updates.currentBalance = parseFloat(user.currentBalance) || 0;
    }

    if (typeof user.lockedBalance === 'string') {
      updates.lockedBalance = parseFloat(user.lockedBalance) || 0;
    }

    if (Object.keys(updates).length > 0) {
      await collection.updateOne({ _id: user._id }, { $set: updates });
      updated++;
    }
  }

  console.log(`✅ Users rollback complete: ${updated} updated`);
  return updated;
}

async function rollbackTransactions() {
  console.log('\n📊 Rolling back Transactions collection...');

  const collection = mongoose.connection.collection('transactions');
  const transactions = await collection.find({}).toArray();
  let updated = 0;

  for (const tx of transactions) {
    const updates = {};

    if (typeof tx.amount === 'string') {
      updates.amount = parseFloat(tx.amount) || 0;
    }

    if (typeof tx.gasUsed === 'string') {
      updates.gasUsed = parseFloat(tx.gasUsed) || 0;
    }

    if (typeof tx.gasPrice === 'string') {
      updates.gasPrice = parseFloat(tx.gasPrice) || 0;
    }

    if (typeof tx.networkFee === 'string') {
      updates.networkFee = parseFloat(tx.networkFee) || 0;
    }

    if (Object.keys(updates).length > 0) {
      await collection.updateOne({ _id: tx._id }, { $set: updates });
      updated++;
    }
  }

  console.log(`✅ Transactions rollback complete: ${updated} updated`);
  return updated;
}

async function rollbackGames() {
  console.log('\n📊 Rolling back Games collection...');

  const collection = mongoose.connection.collection('games');
  const games = await collection.find({}).toArray();
  let updated = 0;

  for (const game of games) {
    const updates = {};

    if (typeof game.totalPrizePool === 'string') {
      updates.totalPrizePool = parseFloat(game.totalPrizePool) || 0;
    }

    if (Object.keys(updates).length > 0) {
      await collection.updateOne({ _id: game._id }, { $set: updates });
      updated++;
    }
  }

  console.log(`✅ Games rollback complete: ${updated} updated`);
  return updated;
}

async function rollbackPortfolios() {
  console.log('\n📊 Rolling back Portfolios collection...');

  const collection = mongoose.connection.collection('portfolios');
  const portfolios = await collection.find({}).toArray();
  let updated = 0;

  for (const portfolio of portfolios) {
    const updates = {};

    if (portfolio.gameOutcome && typeof portfolio.gameOutcome.reward === 'string') {
      updates['gameOutcome.reward'] = parseFloat(portfolio.gameOutcome.reward) || 0;
    }

    if (Object.keys(updates).length > 0) {
      await collection.updateOne({ _id: portfolio._id }, { $set: updates });
      updated++;
    }
  }

  console.log(`✅ Portfolios rollback complete: ${updated} updated`);
  return updated;
}

async function runRollback() {
  console.log('⚠️  Wei Migration Rollback');
  console.log('========================\n');
  console.log('⚠️  WARNING: This will convert String values back to Numbers!');
  console.log('⚠️  Large wei values may lose precision due to JavaScript number limits!\n');
  console.log(`📍 Database: ${MONGODB_URI}\n`);

  const answer = await question('Are you sure you want to rollback? (yes/no): ');

  if (answer.toLowerCase() !== 'yes') {
    console.log('\n❌ Rollback cancelled.');
    rl.close();
    process.exit(0);
  }

  try {
    console.log('\n🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const results = {
      users: await rollbackUsers(),
      transactions: await rollbackTransactions(),
      games: await rollbackGames(),
      portfolios: await rollbackPortfolios(),
    };

    console.log('\n\n🎉 Rollback Complete!');
    console.log('====================\n');
    console.log('📊 Summary:');
    console.log(`  Users:        ${results.users} rolled back`);
    console.log(`  Transactions: ${results.transactions} rolled back`);
    console.log(`  Games:        ${results.games} rolled back`);
    console.log(`  Portfolios:   ${results.portfolios} rolled back`);

    const total = results.users + results.transactions + results.games + results.portfolios;
    console.log(`\n  Total: ${total} documents rolled back\n`);

    console.log('⚠️  Remember: Large wei values may have lost precision!');
    console.log('⚠️  Consider re-syncing with blockchain data if needed.\n');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Rollback failed:', error);
    process.exit(1);
  } finally {
    rl.close();
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB\n');
  }
}

// Run the rollback
runRollback();

