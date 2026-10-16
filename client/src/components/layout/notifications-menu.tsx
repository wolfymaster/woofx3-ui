import { api } from "@convex/_generated/api";
import { notificationLinkKind } from "@convex/lib/notifications";
import type { InboxNotification } from "@convex/notifications";
import { useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Bell, Check, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** The bell in the app header and the user's notifications under it. */
export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const hasUnread = useQuery(api.notifications.hasUnread) ?? false;
  // The list is read only while the menu is open; the dot needs just one row.
  const notifications = useQuery(api.notifications.list, open ? {} : "skip");
  const markAllRead = useMutation(api.notifications.markAllRead);
  const clearAll = useMutation(api.notifications.clearAll);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={hasUnread ? "Notifications (unread)" : "Notifications"}
          data-testid="button-notifications"
        >
          <Bell className="h-5 w-5" />
          {hasUnread && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" data-testid="unread-dot" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <p className="text-sm font-medium">Notifications</p>
          {notifications && notifications.length > 0 && (
            <div className="flex items-center gap-1">
              {hasUnread && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void markAllRead()}>
                  Mark all read
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void clearAll()}>
                Clear all
              </Button>
            </div>
          )}
        </div>
        {notifications === undefined ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">You're all caught up.</p>
        ) : (
          <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
            <ul className="divide-y">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification._id}
                  notification={notification}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationItem({ notification, onNavigate }: { notification: InboxNotification; onNavigate: () => void }) {
  const [, navigate] = useLocation();
  const markRead = useMutation(api.notifications.markRead);
  const dismiss = useMutation(api.notifications.dismiss);
  const linkKind = notification.link === null ? null : notificationLinkKind(notification.link);

  const markThisRead = () => {
    if (!notification.read) {
      void markRead({ id: notification._id });
    }
  };

  return (
    <li className={cn("group flex gap-3 px-4 py-3", !notification.read && "bg-primary/5")}>
      <span
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", notification.read ? "bg-transparent" : "bg-primary")}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className={cn("text-sm break-words", !notification.read && "font-medium")}>{notification.heading}</p>
        <p className="text-xs text-muted-foreground break-words">{notification.description}</p>
        <div className="flex items-center gap-3 pt-0.5">
          <span className="text-[11px] text-muted-foreground">
            {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
          </span>
          {linkKind === "internal" && notification.link !== null && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              onClick={() => {
                markThisRead();
                onNavigate();
                navigate(notification.link ?? "/");
              }}
            >
              {notification.actionLabel ?? "View"} <ArrowRight className="h-3 w-3" />
            </button>
          )}
          {linkKind === "external" && notification.link !== null && (
            <a
              href={notification.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              onClick={markThisRead}
            >
              {notification.actionLabel ?? "Open"} <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-0.5">
        {!notification.read && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Mark as read"
            title="Mark as read"
            onClick={markThisRead}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Clear notification"
          title="Clear"
          onClick={() => void dismiss({ id: notification._id })}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}
