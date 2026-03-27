import { SCRAPE_JOB_CONCURRENCY } from '../config.js';

export interface JobScheduler {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  getState(): { activeCount: number; queuedCount: number; maxConcurrent: number };
}

export interface JobSchedulerDependencies {
  maxConcurrent?: number;
}

export function createJobScheduler(dependencies: JobSchedulerDependencies = {}): JobScheduler {
  const maxConcurrent = dependencies.maxConcurrent ?? SCRAPE_JOB_CONCURRENCY;
  let activeCount = 0;
  const queue: Array<() => void> = [];

  function pump(): void {
    while (activeCount < maxConcurrent && queue.length) {
      const next = queue.shift();
      if (!next) {
        return;
      }
      activeCount += 1;
      next();
    }
  }

  return {
    enqueue(task) {
      return new Promise((resolve, reject) => {
        queue.push(() => {
          void task()
            .then(resolve, reject)
            .finally(() => {
              activeCount = Math.max(0, activeCount - 1);
              pump();
            });
        });
        pump();
      });
    },

    getState() {
      return {
        activeCount,
        queuedCount: queue.length,
        maxConcurrent
      };
    }
  };
}
