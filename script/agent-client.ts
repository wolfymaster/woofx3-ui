/**
 * Agent Client - Connect to the relay server
 *
 * Usage: bun run script/agent-client.ts [name]
 */

import WebSocket from 'ws';

const name = process.argv[2] || 'Agent';
const ws = new WebSocket('ws://localhost:9999');

ws.on('open', () => {
  console.log(`Connected to relay server as "${name}"`);
  ws.send(JSON.stringify({ type: 'identify', name }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', JSON.stringify(msg, null, 2));
});

ws.on('close', () => {
  console.log('Disconnected from relay');
});

ws.on('error', (err) => {
  console.error('Connection error:', err.message);
});

// Keep the process alive and handle stdin for sending messages
process.stdin.setEncoding('utf8');
process.stdin.on('data', (input) => {
  const content = input.toString().trim();
  if (content) {
    ws.send(JSON.stringify({ type: 'message', content }));
  }
});
