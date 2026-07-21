/**
 * HSMC PoW Mining Web Worker
 *
 * Runs SHA-256 proof-of-work in a dedicated thread.
 * Receives mining jobs from the main thread (MiningRPCClient),
 * iterates nonces using crypto.getRandomValues() for the starting point,
 * and posts shares/hashrate back.
 *
 * Protocol:
 *   Main → Worker: { type: 'start', data: { jobId, header, target } }
 *   Main → Worker: { type: 'stop' }
 *   Worker → Main: { type: 'share', data: { jobId, nonce, hash } }
 *   Worker → Main: { type: 'hashrate', data: number }
 */

interface MiningJob {
  jobId: string;
  /** Hex-encoded block header (without nonce) to hash */
  header: string;
  /** Hex-encoded target (no 0x prefix) */
  target: string;
}

let mining = false;
let currentJobId: string | null = null;

/** Compute SHA-256 hash of a UTF-8 string, returns hex without 0x prefix */
async function sha256(data: string): Promise<string> {
  const input = new TextEncoder().encode(data);
  const buf = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generate a random starting nonce using crypto.getRandomValues() */
function randomNonce(): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0];
}

async function mine(job: MiningJob, startNonce: number): Promise<void> {
  const targetBig = BigInt('0x' + job.target);
  let nonce = startNonce;
  let hashCount = 0;
  const startTime = performance.now();

  while (mining && currentJobId === job.jobId) {
    // Build header + nonce (8-char hex, zero-padded)
    const input = job.header + nonce.toString(16).padStart(8, '0');
    const hash = await sha256(input);
    hashCount++;

    // Report hashrate periodically (every 500 hashes)
    if (hashCount % 500 === 0) {
      const elapsed = (performance.now() - startTime) / 1000;
      const hashrate = Math.round(hashCount / elapsed);
      self.postMessage({ type: 'hashrate', data: hashrate });
    }

    // Check if hash meets target
    const hashBig = BigInt('0x' + hash);
    if (hashBig <= targetBig) {
      self.postMessage({
        type: 'share',
        data: {
          jobId: job.jobId,
          nonce,
          hash: '0x' + hash,
        },
      });
    }

    nonce++;

    // Yield to the event loop every 5000 iterations to avoid blocking
    if (nonce % 5000 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { type, data } = e.data;

  switch (type) {
    case 'start': {
      mining = true;
      const job = data as MiningJob;
      currentJobId = job.jobId;
      const nonce = randomNonce();
      await mine(job, nonce);
      break;
    }
    case 'stop': {
      mining = false;
      currentJobId = null;
      break;
    }
  }
};
