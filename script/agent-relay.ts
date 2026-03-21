/**
 * Agent Relay Server
 *
 * A WebSocket server that allows multiple Claude agents to exchange messages.
 * Each connected agent can send messages that get broadcast to all other agents.
 *
 * Usage:
 *   npx tsx script/agent-relay.ts [port]
 *
 * Default port: 9999
 */

import { WebSocketServer, WebSocket } from 'ws';

const PORT = parseInt(process.argv[2] || '9999', 10);

interface AgentConnection {
  id: string;
  ws: WebSocket;
  name?: string;
  joinedAt: Date;
}

const agents = new Map<string, AgentConnection>();
let messageId = 0;

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function broadcast(senderId: string, message: object) {
  const payload = JSON.stringify(message);
  for (const [id, agent] of agents) {
    if (id !== senderId && agent.ws.readyState === WebSocket.OPEN) {
      agent.ws.send(payload);
    }
  }
}

function sendToAgent(agentId: string, message: object) {
  const agent = agents.get(agentId);
  if (agent && agent.ws.readyState === WebSocket.OPEN) {
    agent.ws.send(JSON.stringify(message));
  }
}

const wss = new WebSocketServer({ port: PORT });

console.log(`\n🔗 Agent Relay Server started on ws://localhost:${PORT}`);
console.log(`\nWaiting for agents to connect...\n`);
console.log(`─────────────────────────────────────────────────`);

wss.on('connection', (ws) => {
  const agentId = generateId();
  const agent: AgentConnection = {
    id: agentId,
    ws,
    joinedAt: new Date(),
  };

  agents.set(agentId, agent);

  console.log(`[${new Date().toISOString()}] Agent connected: ${agentId}`);
  console.log(`  Total agents: ${agents.size}`);

  // Send welcome message with agent ID
  ws.send(JSON.stringify({
    type: 'welcome',
    agentId,
    connectedAgents: agents.size,
    instructions: `You are connected to the agent relay. Your ID is "${agentId}". ` +
      `Send messages with { "type": "message", "content": "..." } to broadcast to other agents. ` +
      `Use { "type": "identify", "name": "..." } to set your display name.`,
  }));

  // Notify other agents
  broadcast(agentId, {
    type: 'agent_joined',
    agentId,
    totalAgents: agents.size,
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const timestamp = new Date().toISOString();
      const displayName = agent.name || agentId;

      switch (message.type) {
        case 'identify':
          agent.name = message.name;
          console.log(`[${timestamp}] Agent ${agentId} identified as "${message.name}"`);
          broadcast(agentId, {
            type: 'agent_identified',
            agentId,
            name: message.name,
          });
          break;

        case 'message':
          messageId++;
          console.log(`[${timestamp}] Message #${messageId} from ${displayName}:`);
          console.log(`  ${message.content?.substring(0, 200)}${message.content?.length > 200 ? '...' : ''}`);
          broadcast(agentId, {
            type: 'message',
            id: messageId,
            from: agentId,
            fromName: agent.name,
            content: message.content,
            timestamp,
          });
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp }));
          break;

        case 'list_agents':
          const agentList = Array.from(agents.values()).map(a => ({
            id: a.id,
            name: a.name,
            joinedAt: a.joinedAt.toISOString(),
          }));
          ws.send(JSON.stringify({ type: 'agent_list', agents: agentList }));
          break;

        default:
          // Forward unknown message types as-is
          broadcast(agentId, {
            ...message,
            from: agentId,
            fromName: agent.name,
            timestamp,
          });
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Error processing message:`, err);
    }
  });

  ws.on('close', () => {
    agents.delete(agentId);
    console.log(`[${new Date().toISOString()}] Agent disconnected: ${agent.name || agentId}`);
    console.log(`  Total agents: ${agents.size}`);

    broadcast(agentId, {
      type: 'agent_left',
      agentId,
      name: agent.name,
      totalAgents: agents.size,
    });
  });

  ws.on('error', (err) => {
    console.error(`[${new Date().toISOString()}] WebSocket error for ${agent.name || agentId}:`, err);
  });
});

wss.on('error', (err) => {
  console.error('Server error:', err);
});

process.on('SIGINT', () => {
  console.log('\n\nShutting down relay server...');
  wss.close();
  process.exit(0);
});
