import { readFile } from 'node:fs/promises';
import { createPreset } from '../src/server/services/presetStore.js';
import { parsePresetRequestIssueBody } from '../src/server/services/presetRequest.js';

type IssueEvent = {
  issue?: {
    number?: number;
    body?: string;
  };
};

async function main(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error('GITHUB_EVENT_PATH is required.');
  }

  const rawEvent = await readFile(eventPath, 'utf8');
  const event = JSON.parse(rawEvent) as IssueEvent;
  const body = event.issue?.body;
  if (!body) {
    throw new Error('Issue body is empty.');
  }

  const preset = await createPreset(parsePresetRequestIssueBody(body));
  console.log(`Created preset ${preset.id} from issue #${event.issue?.number ?? 'unknown'}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Unable to import preset request.');
  process.exitCode = 1;
});
