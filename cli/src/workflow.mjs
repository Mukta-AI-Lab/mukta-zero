// Copyright (c) 2026 Mukta Solucoes em Informatica Ltda.
// SPDX-License-Identifier: BUSL-1.1
//
// Use of this software is governed by the Business Source License 1.1
// included in the repository LICENSE file. Change License: AGPL-3.0-only
// Mukta Zero - https://github.com/mukta-ai-lab/mukta-zero
/**
 * Workflow Engine for mz-cli
 * Handles parallel execution of tasks with limited concurrency.
 */

export async function runWorkflow(opts) {
  const {
    items = [],
    run,
    concurrency = 4,
    synthesize,
    log
  } = opts;

  if (typeof run !== 'function') {
    throw new TypeError('The "run" option must be an async function.');
  }

  const results = new Array(items.length);
  let currentIndex = 0;

  /**
   * Worker function that consumes items from the queue
   * until all items are processed.
   */
  async function worker() {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      const item = items[index];

      if (log) log(`Processing item ${index}...`);

      try {
        // Execute the provided run function and store result at the correct index
        results[index] = await run(item, index);
      } catch (err) {
        // Capture error without stopping other concurrent executions
        results[index] = { error: String(err) };
        if (log) log(`Error processing item ${index}: ${String(err)}`);
      }
    }
  }

  // Initialize the pool of workers based on concurrency limit
  const poolSize = Math.min(concurrency, items.length);
  const workers = [];

  for (let i = 0; i < poolSize; i++) {
    workers.push(worker());
  }

  // Wait for all workers to complete their queues
  await Promise.all(workers);

  // If a synthesis function is provided, aggregate the results
  if (typeof synthesize === 'function') {
    const synthesized = await synthesize(results);
    return {
      results,
      synthesized
    };
  }

  return results;
}