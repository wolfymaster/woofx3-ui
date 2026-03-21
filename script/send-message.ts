/**
 * Send a message to the agent relay
 * Usage: bun run script/send-message.ts <agent-name> "Your message here"
 */

import WebSocket from 'ws';

const agentName = process.argv[2];
const message = process.argv[3];

if (!agentName || !message) {
  console.error('Usage: bun run script/send-message.ts <agent-name> "message"');
  process.exit(1);
}

const ws = new WebSocket('ws://localhost:9999');

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'identify', name: agentName }));
  ws.send(JSON.stringify({ type: 'message', content: message }));
  setTimeout(() => {
    ws.close();
    process.exit(0);
  }, 500);
});

ws.on('error', (err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
