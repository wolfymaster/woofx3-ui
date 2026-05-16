import { useState } from "react";
import { Zap, Play, Square, SkipForward, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QuickActionsWidget() {
  const [isLive, setIsLive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Quick Actions</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant={isLive ? "destructive" : "default"}
          size="sm"
          onClick={() => setIsLive(!isLive)}
          className="w-full"
        >
          {isLive ? (
            <>
              <Square className="h-4 w-4 mr-2" />
              End Stream
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Start Stream
            </>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsMuted(!isMuted)}
          className="w-full"
        >
          {isMuted ? (
            <>
              <VolumeX className="h-4 w-4 mr-2" />
              Unmute
            </>
          ) : (
            <>
              <Volume2 className="h-4 w-4 mr-2" />
              Mute
            </>
          )}
        </Button>
        <Button variant="outline" size="sm" className="w-full">
          <SkipForward className="h-4 w-4 mr-2" />
          Skip Alert
        </Button>
        <Button variant="outline" size="sm" className="w-full">
          <Zap className="h-4 w-4 mr-2" />
          Test Alert
        </Button>
      </div>
    </div>
  );
}
