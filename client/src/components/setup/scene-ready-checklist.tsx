import { DEFAULT_OVERLAY_CANVAS } from "@shared/default-seed";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";

interface ChecklistItem {
  id: string;
  label: string;
}

const { width, height } = DEFAULT_OVERLAY_CANVAS;

const ITEMS: readonly ChecklistItem[] = [
  { id: "app", label: "Open your streaming app." },
  { id: "source", label: "Add a Browser source to the scene you stream." },
  { id: "size", label: `Set its width to ${width} and its height to ${height}.` },
];

/**
 * Something useful to do while the engine is still being built. The steps need
 * no data from the engine, and the page asks for the link once the build is
 * done, so ticking these off early shortens the rest of setup. Ticks are local:
 * they only remind the streamer where they got to on this visit.
 */
export function SceneReadyChecklist() {
  const [checked, setChecked] = useState<Readonly<Record<string, boolean>>>({});

  return (
    <section className="space-y-3 rounded-lg border p-4" data-testid="scene-ready-checklist">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Get your scene ready</h2>
        <p className="text-sm text-muted-foreground">
          Do this now and your overlay will only need its link when your engine is ready.
        </p>
      </div>
      <ul className="space-y-2">
        {ITEMS.map((item) => (
          <li key={item.id}>
            <label htmlFor={`scene-ready-${item.id}`} className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox
                id={`scene-ready-${item.id}`}
                checked={checked[item.id] === true}
                onCheckedChange={(value) => {
                  setChecked((previous) => ({ ...previous, [item.id]: value === true }));
                }}
                className="mt-0.5"
                data-testid={`checkbox-scene-ready-${item.id}`}
              />
              <span>{item.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
