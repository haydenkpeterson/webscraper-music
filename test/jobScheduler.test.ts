import { describe, expect, it } from 'vitest';
import { createJobScheduler } from '../src/server/services/jobScheduler';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('job scheduler', () => {
  it('runs at most two jobs at a time and preserves fifo queue order', async () => {
    const scheduler = createJobScheduler({ maxConcurrent: 2 });
    const executionOrder: string[] = [];
    const completionOrder: string[] = [];
    let activeCount = 0;
    let maxActiveCount = 0;

    async function runJob(name: string, durationMs: number) {
      await scheduler.enqueue(async () => {
        executionOrder.push(name);
        activeCount += 1;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await delay(durationMs);
        completionOrder.push(name);
        activeCount -= 1;
      });
    }

    await Promise.all([runJob('job-1', 30), runJob('job-2', 10), runJob('job-3', 5)]);

    expect(executionOrder).toEqual(['job-1', 'job-2', 'job-3']);
    expect(completionOrder).toEqual(['job-2', 'job-3', 'job-1']);
    expect(maxActiveCount).toBe(2);
  });
});
