import { useState, useRef, useEffect } from 'react';
import { Send, Smile, Settings2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { transport } from '@/lib/transport';
import type { ChatMessage } from '@/lib/transport';
import { useInstance } from '@/hooks/use-instance';

function ChatMessageItem({ message }: { message: ChatMessage }) {
  const displayName = message.displayName || message.username;
  const initials = displayName.slice(0, 2).toUpperCase();
  const color = message.color || '#888888';

  return (
    <div className="flex items-start gap-2 py-1.5 px-2 hover:bg-muted/30 rounded" data-testid={`chat-message-${message.id}`}>
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarFallback className="text-[10px]" style={{ backgroundColor: color + '20', color }}>
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(message.badges ?? []).map((badge) => (
            <Badge key={badge} variant="secondary" className="text-[9px] px-1 py-0 h-4">
              {badge}
            </Badge>
          ))}
          <span className="text-xs font-semibold" style={{ color }}>
            {displayName}
          </span>
        </div>
        <p className="text-sm text-foreground break-words">{message.message}</p>
      </div>
    </div>
  );
}

interface ChatModuleProps {
  config?: Record<string, unknown>;
}

export function ChatModule({ config: _config }: ChatModuleProps) {
  const { instance } = useInstance();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to chat messages via transport
  useEffect(() => {
    if (!instance) return;
    const instanceId = instance._id;

    const unsubscribe = transport.subscribeChatMessages(instanceId, (msg) => {
      setMessages((prev) => [msg, ...prev].slice(0, 100));
    });

    return unsubscribe;
  }, [instance?._id]);

  // Auto-scroll to latest
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!inputValue.trim() || !instance) return;
    transport.sendChatMessage(instance._id, inputValue).catch(console.error);
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Chat</span>
          <Badge variant="secondary" className="text-xs">
            <Users className="h-3 w-3 mr-1" />
            {messages.length}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="py-2">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-4">
              {instance ? 'Waiting for chat messages...' : 'No instance connected'}
            </div>
          ) : (
            [...messages].reverse().map((msg) => (
              <ChatMessageItem key={msg.id} message={msg} />
            ))
          )}
        </div>
      </ScrollArea>

      <div className="p-2 border-t border-border shrink-0">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Send a message..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 h-8 text-sm"
            data-testid="input-chat-message"
          />
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <Smile className="h-4 w-4" />
          </Button>
          <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleSend} data-testid="button-send-chat">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
