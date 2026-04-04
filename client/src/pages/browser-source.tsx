import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";

const CONVEX_SITE_URL = import.meta.env.VITE_CONVEX_SITE_URL || "https://avid-eagle-113.convex.site";

interface LayerDescriptor {
  type: "text" | "image" | "video" | "audio" | "lottie";
  content: string;
  style: Record<string, string>;
  assetUrl?: string;
  animationIn?: string;
  animationOut?: string;
  volume?: number;
}

interface AlertDescriptor {
  _id: string;
  alertTypes: string[];
  layers: LayerDescriptor[];
  duration: number;
  enabled: boolean;
}

interface SceneSlot {
  _id: string;
  name: string;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  queueMode: "stack" | "concurrent" | "interrupt";
}

interface Scene {
  _id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
}

interface WidgetSettings {
  [key: string]: unknown;
}

interface Widget {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  visible: boolean;
  moduleWidgetId?: string;
  widgetSettings?: WidgetSettings;
}

interface SceneConfig {
  scene: Scene;
  slots: SceneSlot[];
  alertDescriptors: AlertDescriptor[];
  widgets?: Widget[];
}

interface AlertEvent {
  type: string;
  user: string;
  amount?: number;
  message?: string;
  tier?: string;
  timestamp: number;
}

function ConnectionIndicator({ status }: { status: "connected" | "reconnecting" | "disconnected" }) {
  const colors = {
    connected: "bg-green-500",
    reconnecting: "bg-yellow-500",
    disconnected: "bg-red-500",
  };

  return (
    <div className="fixed bottom-4 right-4 flex items-center gap-2 bg-black/50 rounded-full px-3 py-1.5 z-50">
      <div className={`w-2 h-2 rounded-full ${colors[status]}`} />
      <span className="text-white text-xs">{status}</span>
    </div>
  );
}

function TextLayer({ content, style }: { content: string; style: Record<string, string> }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        fontFamily: style.fontFamily || "sans-serif",
        fontSize: style.fontSize || "24px",
        color: style.color || "#ffffff",
        textShadow: style.textShadow,
      }}
    >
      {content}
    </div>
  );
}

function WidgetIframe({
  widget,
  sceneWidth,
  sceneHeight,
  alertEvents,
}: {
  widget: Widget;
  sceneWidth: number;
  sceneHeight: number;
  alertEvents: AlertEvent[];
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [isReady, setIsReady] = useState(false);

  const style: React.CSSProperties = {
    position: "absolute",
    left: (widget.position.x / sceneWidth) * 100 + "%",
    top: (widget.position.y / sceneHeight) * 100 + "%",
    width: (widget.size.width / sceneWidth) * 100 + "%",
    height: (widget.size.height / sceneHeight) * 100 + "%",
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "ready") {
        setIsReady(true);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (isReady && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        {
          type: "settings",
          data: widget.widgetSettings || {},
        },
        "*"
      );

      alertEvents.forEach((alert) => {
        iframeRef.current?.contentWindow?.postMessage(
          {
            type: "alert",
            data: alert,
          },
          "*"
        );
      });
    }
  }, [isReady, widget.widgetSettings, alertEvents]);

  const widgetUrl = `/api/widgets/${widget.moduleWidgetId}/index.html`;

  return (
    <iframe
      ref={iframeRef}
      src={widgetUrl}
      style={style}
      className="border-0"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}

export default function BrowserSource() {
  const [, params] = useRoute("/obs/source/:sourceKey");
  const sourceKey = params?.sourceKey;

  const [config, setConfig] = useState<SceneConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<"connected" | "reconnecting" | "disconnected">(
    "reconnecting"
  );
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);

  useEffect(() => {
    if (!sourceKey) return;

    const fetchConfig = async () => {
      try {
        const response = await fetch(`${CONVEX_SITE_URL}/api/browser-source/${sourceKey}/claim`, {
          method: "POST",
        });

        if (!response.ok) {
          throw new Error("Invalid source key");
        }

        const data = await response.json();
        setConfig(data);
        setConnectionStatus("connected");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load scene");
        setConnectionStatus("disconnected");
      }
    };

    fetchConfig();
  }, [sourceKey]);

  useEffect(() => {
    if (!sourceKey || !config) return;

    const pollAlerts = async () => {
      try {
        const response = await fetch(`${CONVEX_SITE_URL}/api/browser-source/${sourceKey}/alerts?state=pending`);
        if (response.ok) {
          const data = await response.json();
        }
      } catch {}
    };

    const interval = setInterval(pollAlerts, 2000);
    return () => clearInterval(interval);
  }, [sourceKey, config]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black text-white">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Error</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black text-white">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  const { scene, slots, alertDescriptors, widgets = [] } = config;

  return (
    <div
      className="w-full h-full overflow-hidden"
      style={{
        backgroundColor: scene.backgroundColor === "transparent" ? "transparent" : scene.backgroundColor,
      }}
    >
      {widgets
        .filter((w) => w.type === "module-widget" && w.visible)
        .map((widget) => (
          <WidgetIframe
            key={widget.id}
            widget={widget}
            sceneWidth={scene.width}
            sceneHeight={scene.height}
            alertEvents={alertEvents}
          />
        ))}

      <ConnectionIndicator status={connectionStatus} />
    </div>
  );
}
