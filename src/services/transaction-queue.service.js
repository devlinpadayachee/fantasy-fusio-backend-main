class TransactionQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.currentNonce = null;
    this.lastNonceUpdate = 0;
    this.nonceRefreshInterval = 10000; // 10 seconds
    this.maxRetries = 3;
    this.provider = null;
    this.wallet = null;
  }

  initialize(provider, wallet) {
    this.provider = provider;
    this.wallet = wallet;
  }

  async getCurrentNonce() {
    const now = Date.now();
    // Refresh nonce if it's stale or null
    if (!this.currentNonce || (now - this.lastNonceUpdate) > this.nonceRefreshInterval) {
      this.currentNonce = await this.wallet.getTransactionCount();
      this.lastNonceUpdate = now;
    }
    return this.currentNonce;
  }

  async addTransaction(txFunc, description = '') {
    return new Promise((resolve, reject) => {
      this.queue.push({
        txFunc,
        description,
        resolve,
        reject,
        retries: 0,
      });
      
      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const { txFunc, description, resolve, reject, retries } = this.queue[0];
      
      try {
        const nonce = await this.getCurrentNonce();
        console.log(`Processing transaction: ${description} with nonce ${nonce}`);

        // Execute the transaction function with current nonce
        const tx = await txFunc(nonce);
        const receipt = await tx.wait();

        // Transaction successful
        this.currentNonce++;
        this.lastNonceUpdate = Date.now();
        this.queue.shift(); // Remove from queue
        resolve(receipt);

      } catch (error) {
        console.error(`Transaction failed: ${description}`, error);

        // Handle nonce too low error
        if (error.message.includes('nonce too low')) {
          this.currentNonce = await this.wallet.getTransactionCount();
          this.lastNonceUpdate = Date.now();
          continue; // Retry with new nonce
        }

        // Handle replacement transaction underpriced
        if (error.message.includes('replacement transaction underpriced')) {
          if (retries < this.maxRetries) {
            const tx = this.queue.shift();
            tx.retries++;
            this.queue.push(tx); // Move to end of queue
            continue;
          }
        }

        // If max retries exceeded or other error
        this.queue.shift(); // Remove failed transaction
        reject(error);
      }
    }

    this.isProcessing = false;
  }

  // Clear the queue (useful for cleanup)
  clearQueue() {
    this.queue.forEach(item => {
      item.reject(new Error('Queue cleared'));
    });
    this.queue = [];
    this.isProcessing = false;
  }
}

module.exports = new TransactionQueue();
