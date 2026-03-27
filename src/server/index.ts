import { createApp } from './app.js';
import { SERVER_PORT } from './config.js';

const app = createApp();

app.listen(SERVER_PORT, () => {
  console.log(`Used Gear Finder listening on http://localhost:${SERVER_PORT}`);
});
