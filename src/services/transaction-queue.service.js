/**
 * Transaction Queue Service
 *
 * Handles sequential blockchain transactions to prevent nonce collisions.
 *
 * TWO TYPES OF NONCES:
 * 1. Wallet Nonce - Ethereum account transaction counter (managed here)
 * 2. Contract Nonce - Smart contract's internal counter for signature verification
 *    (must be fetched fresh INSIDE txFunc callbacks, not before)
 */
class TransactionQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.currentNonce = null;
    this.maxRetries = 3;
    this.provider = null;
    this.wallet = null;

    // Concurrency control - process one at a time for safety
    this.processingLock = false;
  }

  initialize(provider, wallet) {
    this.provider = provider;
    this.wallet = wallet;
  }

  /**
   * Get current wallet nonce
   * Uses 'pending' to include unconfirmed transactions
   */
  async getCurrentNonce() {
    if (this.currentNonce === null) {
      this.currentNonce = await this.wallet.getTransactionCount('pending');
    }
    return this.currentNonce;
  }

  /**
   * Force refresh nonce from blockchain
   * Used after errors to resync
   */
  async refreshNonce() {
    this.currentNonce = await this.wallet.getTransactionCount('pending');
    console.log(`[TX-QUEUE] Nonce refreshed to ${this.currentNonce}`);
    return this.currentNonce;
  }

  /**
   * Add a transaction to the queue
   * @param {Function} txFunc - Async function that receives walletNonce and returns tx
   * @param {string} description - Human-readable description for logging
   * @param {Object} options - Additional options
   * @returns {Promise} Resolves with transaction receipt
   */
  async addTransaction(txFunc, description = '', options = {}) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        txFunc,
        description,
        resolve,
        reject,
        retries: 0,
        maxRetries: options.maxRetries || this.maxRetries,
        addedAt: Date.now(),
      });

      console.log(`[TX-QUEUE] Added: ${description} (Queue size: ${this.queue.length})`);

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process transactions sequentially
   * This ensures wallet nonces are used in order
   */
  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    console.log(`[TX-QUEUE] Starting queue processing (${this.queue.length} items)`);

    while (this.queue.length > 0) {
      const item = this.queue[0];
      const { txFunc, description, resolve, reject, retries, maxRetries, addedAt } = item;

      const waitTime = Date.now() - addedAt;
      if (waitTime > 5000) {
        console.log(`[TX-QUEUE] Processing: ${description} (waited ${waitTime}ms)`);
      }

      try {
        const walletNonce = await this.getCurrentNonce();
        console.log(`[TX-QUEUE] Executing: ${description} with wallet nonce ${walletNonce}`);

        // Execute the transaction function with current wallet nonce
        // IMPORTANT: Contract nonce should be fetched INSIDE txFunc
        const tx = await txFunc(walletNonce);

        console.log(`[TX-QUEUE] Waiting for confirmation: ${description} (tx: ${tx.hash})`);
        const receipt = await tx.wait();

        // Transaction successful - increment our tracked nonce
        this.currentNonce++;
        this.queue.shift();

        console.log(`[TX-QUEUE] ✅ Success: ${description} (block: ${receipt.blockNumber})`);
        resolve(receipt);

      } catch (error) {
        const errorMsg = error.message || error.toString();
        console.error(`[TX-QUEUE] ❌ Failed: ${description}`, errorMsg);

        // Handle specific error types
        if (this.isNonceTooLowError(errorMsg)) {
          console.log(`[TX-QUEUE] Nonce too low - refreshing and retrying`);
          await this.refreshNonce();
          continue; // Retry immediately with fresh nonce
        }

        if (this.isReplacementUnderpricedError(errorMsg)) {
          console.log(`[TX-QUEUE] Replacement underpriced - refreshing nonce`);
          await this.refreshNonce();

          if (retries < maxRetries) {
            item.retries++;
            continue; // Retry with same position
          }
        }

        // Contract nonce mismatch (signature verification failed)
        if (this.isContractNonceError(errorMsg)) {
          console.log(`[TX-QUEUE] Contract nonce mismatch - retrying`);

          if (retries < maxRetries) {
            item.retries++;
            // Small delay to allow contract state to settle
            await this.delay(500);
            continue;
          }
        }

        // Gas estimation or execution reverted
        if (this.isExecutionRevertedError(errorMsg)) {
          console.error(`[TX-QUEUE] Execution reverted - not retrying: ${description}`);
          this.queue.shift();
          reject(error);
          continue;
        }

        // Network/timeout errors - retry with backoff
        if (this.isNetworkError(errorMsg) && retries < maxRetries) {
          console.log(`[TX-QUEUE] Network error - retrying in ${(retries + 1) * 2}s`);
          item.retries++;
          await this.delay((retries + 1) * 2000);
          await this.refreshNonce();
          continue;
        }

        // Max retries exceeded or unhandled error
        console.error(`[TX-QUEUE] Giving up on: ${description} after ${retries} retries`);
        this.queue.shift();
        reject(error);
      }
    }

    this.isProcessing = false;
    console.log(`[TX-QUEUE] Queue empty, processing stopped`);
  }

  // Error type detection helpers
  isNonceTooLowError(msg) {
    return msg.includes('nonce too low') ||
           msg.includes('nonce has already been used') ||
           msg.includes('NONCE_EXPIRED');
  }

  isReplacementUnderpricedError(msg) {
    return msg.includes('replacement transaction underpriced') ||
           msg.includes('REPLACEMENT_UNDERPRICED');
  }

  isContractNonceError(msg) {
    return msg.includes('Invalid signature') ||
           msg.includes('invalid signature') ||
           msg.includes('signature verification');
  }

  isExecutionRevertedError(msg) {
    return msg.includes('execution reverted') ||
           msg.includes('CALL_EXCEPTION') ||
           msg.includes('transaction failed');
  }

  isNetworkError(msg) {
    return msg.includes('timeout') ||
           msg.includes('ETIMEDOUT') ||
           msg.includes('ECONNRESET') ||
           msg.includes('network error') ||
           msg.includes('could not detect network');
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get queue status for monitoring
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      currentNonce: this.currentNonce,
      pendingTransactions: this.queue.map(item => ({
        description: item.description,
        retries: item.retries,
        waitingMs: Date.now() - item.addedAt,
      })),
    };
  }

  /**
   * Clear the queue (use with caution - for cleanup/shutdown)
   */
  clearQueue() {
    const count = this.queue.length;
    this.queue.forEach(item => {
      item.reject(new Error('Queue cleared'));
    });
    this.queue = [];
    this.isProcessing = false;
    console.log(`[TX-QUEUE] Queue cleared (${count} items removed)`);
  }
}

module.exports = new TransactionQueue();
