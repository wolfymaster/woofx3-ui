import type { PublicPageWidget } from "@shared/user-pages";
import { CounterWidget } from "./counter-widget";
import { FormWidget } from "./form-widget";
import { ImageWidget } from "./image-widget";
import { LinksWidget } from "./links-widget";
import { LiveStatusWidget } from "./live-status-widget";
import { TextWidget } from "./text-widget";
import { TimerWidget } from "./timer-widget";

export function PageWidgetView({ widget }: { widget: PublicPageWidget }) {
  switch (widget.type) {
    case "text":
      return <TextWidget widget={widget} />;
    case "counter":
      return <CounterWidget widget={widget} />;
    case "timer":
      return <TimerWidget widget={widget} />;
    case "live-status":
      return <LiveStatusWidget widget={widget} />;
    case "links":
      return <LinksWidget widget={widget} />;
    case "image":
      return <ImageWidget widget={widget} />;
    case "form":
      return <FormWidget widget={widget} />;
  }
}
