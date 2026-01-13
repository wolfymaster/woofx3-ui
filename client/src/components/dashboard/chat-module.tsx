import { useState, useRef, useEffect } from 'react';
import { Send, Smile, Settings2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ChatMessage {
  id: string;
  user: string;
  message: string;
  timestamp: Date;
  badges?: string[];
  color?: string;
}

const mockMessages: ChatMessage[] = [
  { id: '1', user: 'StreamFan42', message: 'Hey everyone!', timestamp: new Date(Date.now() - 120000), badges: ['subscriber'], color: '#9b59b6' },
  { id: '2', user: 'GamerPro', message: 'Great stream today!', timestamp: new Date(Date.now() - 90000), badges: ['vip'], color: '#e74c3c' },
  { id: '3', user: 'ChatMod', message: 'Remember to follow the rules folks', timestamp: new Date(Date.now() - 60000), badges: ['moderator'], color: '#2ecc71' },
  { id: '4', user: 'NewViewer', message: 'Just found this channel, love the content!', timestamp: new Date(Date.now() - 45000), color: '#3498db' },
  { id: '5', user: 'StreamFan42', message: 'When is the next event?', timestamp: new Date(Date.now() - 30000), badges: ['subscriber'], color: '#9b59b6' },
  { id: '6', user: 'GamerPro', message: 'Check the schedule!', timestamp: new Date(Date.now() - 15000), badges: ['vip'], color: '#e74c3c' },
];

function ChatMessageItem({ message }: { message: ChatMessage }) {
  const initials = message.user.slice(0, 2).toUpperCase();
  
  return (
    <div className="flex items-start gap-2 py-1.5 px-2 hover:bg-muted/30 rounded" data-testid={`chat-message-${message.id}`}>
      <Avatar className="h-6 w-6 shrink-0">
        <AvatarFallback className="text-[10px]" style={{ backgroundColor: message.color + '20', color: message.color }}>
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {message.badges?.map((badge) => (
            <Badge key={badge} variant="secondary" className="text-[9px] px-1 py-0 h-4">
              {badge}
            </Badge>
          ))}
          <span className="text-xs font-semibold" style={{ color: message.color }}>
            {message.user}
          </span>
        </div>
        <p className="text-sm text-foreground break-words">{message.message}</p>
      </div>
    </div>
  );
}

export function ChatModule() {
  const [messages, setMessages] = useState<ChatMessage[]>(mockMessages);
  const [inputValue, setInputValue] = useState('');
  const [viewerCount] = useState(1247);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!inputValue.trim()) return;
    
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      user: 'You',
      message: inputValue,
      timestamp: new Date(),
      badges: ['broadcaster'],
      color: '#f39c12',
    };
    
    setMessages(prev => [...prev, newMessage]);
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
            {viewerCount.toLocaleString()}
          </Badge>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>
      
      <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
        <div className="py-2">
          {messages.map((msg) => (
            <ChatMessageItem key={msg.id} message={msg} />
          ))}
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
