import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { SIDEBAR_RAIL } from "@/components/layout/sidebar-rail";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type AlertNode, alertNodeId, alertSectionAnchor, anchoredPresets } from "@/lib/alert-groups";
import { cn } from "@/lib/utils";

interface AlertGroupRailProps {
  /** Platforms, each holding its nested alert kinds — see buildAlertTree. */
  tree: AlertNode[];
  /** Configured alert count per node id, each counting its whole subtree. */
  counts: Map<string, number>;
  /** Id of the selected node, or null when none is. */
  selectedId: string | null;
  basePath: string;
  /** The section last jumped to on the selected node's page, by its anchor. */
  activeAnchor: string | null;
  /** A jump link was followed; the page scrolls that section's heading to the top. */
  onAnchorSelect: (anchor: string) => void;
}

/** Indent per nesting level, in pixels. */
const LEVEL_INDENT = 12;

/**
 * The submenu under Alerts: a collapsible section per platform, and under each the
 * kinds of thing that can fire an alert, nested as deep as their taxonomy goes.
 *
 * Every registered trigger appears, whether or not an alert exists for it yet, so the
 * rail doubles as the answer to "what can I make an alert for?" — which is why picking
 * a kind and then creating is one step rather than a separate trigger hunt.
 */
export function AlertGroupRail({
  tree,
  counts,
  selectedId,
  basePath,
  activeAnchor,
  onAnchorSelect,
}: AlertGroupRailProps) {
  return (
    <nav className={SIDEBAR_RAIL} aria-label="Alert groups">
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {tree.map((platform) => (
            <PlatformSection
              key={alertNodeId(platform.path)}
              platform={platform}
              counts={counts}
              selectedId={selectedId}
              basePath={basePath}
              activeAnchor={activeAnchor}
              onAnchorSelect={onAnchorSelect}
            />
          ))}
        </div>
      </ScrollArea>
    </nav>
  );
}

interface NodeProps {
  counts: Map<string, number>;
  selectedId: string | null;
  basePath: string;
  activeAnchor: string | null;
  onAnchorSelect: (anchor: string) => void;
}

function PlatformSection({ platform, ...nodeProps }: NodeProps & { platform: AlertNode }) {
  const { counts, selectedId } = nodeProps;
  const id = alertNodeId(platform.path);
  const [open, setOpen] = useOpenWhenSelectedInside(id, selectedId, true);
  const count = counts.get(id) ?? 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {/* A filled bar rather than a link: a platform divides the rail, it is not somewhere
          to go, so it reads apart from the entries below instead of competing with the
          selected one's highlight. */}
      <CollapsibleTrigger
        className="flex w-full items-center gap-1.5 rounded-md bg-primary px-2.5 py-2 text-primary-foreground text-sm font-bold uppercase tracking-wide hover:bg-primary/90"
        data-testid={`alert-platform-${id}`}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="truncate">{platform.label}</span>
        {count > 0 && (
          <span className="ml-auto normal-case tracking-normal font-normal text-[11px] text-primary-foreground/70">
            {count}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-0.5 pt-1">
        {platform.children.map((node) => (
          <RailNode key={alertNodeId(node.path)} node={node} depth={0} {...nodeProps} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function RailNode({ node, depth, ...nodeProps }: NodeProps & { node: AlertNode; depth: number }) {
  const { counts, selectedId, basePath, activeAnchor, onAnchorSelect } = nodeProps;
  const id = alertNodeId(node.path);
  const anchors = anchoredPresets(node);
  const [open, setOpen] = useOpenWhenSelectedInside(id, selectedId, false, anchors.length > 0);
  const hasChildren = node.children.length > 0 || anchors.length > 0;
  const isActive = selectedId === id;
  const count = counts.get(id) ?? 0;
  const href = `${basePath}/${node.path.map(encodeURIComponent).join("/")}`;

  return (
    <div>
      <div
        className={cn("flex items-center rounded-md hover:bg-accent", isActive && "bg-accent font-medium")}
        style={{ paddingLeft: depth * LEVEL_INDENT }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex h-8 w-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={open ? `Collapse ${node.label}` : `Expand ${node.label}`}
            aria-expanded={open}
            data-testid={`alert-group-toggle-${id}`}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}
        <Link href={href} className="block flex-1 min-w-0">
          <span
            className="flex items-center justify-between gap-2 py-2 pr-2.5 text-[15px] cursor-pointer"
            aria-current={isActive ? "page" : undefined}
            data-testid={`alert-group-${id}`}
          >
            <span className="truncate">{node.label}</span>
            {count > 0 && <span className="text-[11px] text-muted-foreground shrink-0">{count}</span>}
          </span>
        </Link>
      </div>
      {hasChildren && open && (
        <div className="space-y-0.5 mt-0.5">
          {node.children.map((child) => (
            <RailNode key={alertNodeId(child.path)} node={child} depth={depth + 1} {...nodeProps} />
          ))}
          {anchors.map((preset) => {
            const anchor = alertSectionAnchor(preset);
            const isCurrent = isActive && activeAnchor === anchor;
            return (
              <Link
                key={preset.id}
                href={`${href}#${anchor}`}
                onClick={() => onAnchorSelect(anchor)}
                className={cn(
                  "block truncate rounded-md py-1.5 pr-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground",
                  isCurrent && "text-foreground"
                )}
                style={{ paddingLeft: (depth + 1) * LEVEL_INDENT + 24 }}
                aria-current={isCurrent ? "location" : undefined}
                data-testid={`alert-anchor-${anchor}`}
              >
                {preset.name}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Open state for a collapsible entry that also opens itself whenever the selection
 * moves somewhere inside it, so following a link never lands on a hidden entry. An
 * entry listing jumps to its own sections opens when it is selected itself, too.
 */
function useOpenWhenSelectedInside(
  id: string,
  selectedId: string | null,
  initiallyOpen: boolean,
  opensWhenSelected = false
): [boolean, (open: boolean) => void] {
  const selectedInside = (selectedId?.startsWith(`${id}/`) ?? false) || (opensWhenSelected && selectedId === id);
  const [open, setOpen] = useState(initiallyOpen || selectedInside);
  useEffect(() => {
    if (selectedInside) {
      setOpen(true);
    }
  }, [selectedInside]);
  return [open, setOpen];
}
