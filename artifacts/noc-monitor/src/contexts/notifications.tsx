import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";

export type NotifSeverity = "critical" | "warning" | "info";
export type NotifEventType =
  | "incident_new"
  | "incident_resolved"
  | "sweep_started"
  | "sweep_completed";

export interface NotifPrefs {
  enabled: boolean;
  severity: NotifSeverity[];
  types: NotifEventType[];
  sound: boolean;
  requireInteraction: boolean;
  onlyWhenHidden: boolean;
}

export interface IncidentNotification {
  id: number;
  siteId: number;
  siteName: string;
  incidentType: string;
  severity: string;
  status: string;
  title: string;
  startedAt: string;
  updatedAt: string;
}

interface NotificationsState {
  prefs: NotifPrefs;
  setPrefs: (prefs: NotifPrefs) => void;
  permission: NotificationPermission | "unsupported";
  requestPermission: () => Promise<void>;
  unreadCount: number;
  recentNotifications: IncidentNotification[];
  markAllRead: () => void;
  lastSeenAt: string | null;
  sendTestNotification: () => void;
}

const PREFS_KEY = "noc.notif.prefs";
const LAST_SEEN_KEY = "noc.notif.lastSeen";
const SHOWN_IDS_KEY = "noc.notif.shownIds";
const POLL_INTERVAL_MS = 30_000;

const DEFAULT_TYPES: NotifEventType[] = ["incident_new", "incident_resolved"];

function readPrefs(): NotifPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<NotifPrefs>;
      return {
        enabled: p.enabled ?? false,
        severity: Array.isArray(p.severity) ? p.severity : ["critical", "warning"],
        types: Array.isArray(p.types) ? p.types : DEFAULT_TYPES,
        sound: p.sound ?? false,
        requireInteraction: p.requireInteraction ?? false,
        onlyWhenHidden: p.onlyWhenHidden ?? false,
      };
    }
  } catch {}
  return {
    enabled: false,
    severity: ["critical", "warning"],
    types: DEFAULT_TYPES,
    sound: false,
    requireInteraction: false,
    onlyWhenHidden: false,
  };
}

function writePrefs(prefs: NotifPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(ts: string): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, ts);
  } catch {}
}

function readShownIds(): Set<number> {
  try {
    const raw = localStorage.getItem(SHOWN_IDS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as number[];
      return new Set(arr);
    }
  } catch {}
  return new Set();
}

function persistShownId(id: number): void {
  try {
    const existing = readShownIds();
    existing.add(id);
    const arr = Array.from(existing).slice(-500);
    localStorage.setItem(SHOWN_IDS_KEY, JSON.stringify(arr));
  } catch {}
}

const NotificationsContext = createContext<NotificationsState | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefsState] = useState<NotifPrefs>(readPrefs);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  });
  const [recentNotifications, setRecentNotifications] = useState<IncidentNotification[]>([]);
  const [lastSeenAt, setLastSeenAtState] = useState<string | null>(readLastSeen);
  const [unreadCount, setUnreadCount] = useState(0);
  const shownIds = useRef<Set<number>>(readShownIds());
  const prefsRef = useRef(prefs);
  const permissionRef = useRef(permission);

  const setPrefs = useCallback((p: NotifPrefs) => {
    setPrefsState(p);
    prefsRef.current = p;
    writePrefs(p);
  }, []);

  useEffect(() => { prefsRef.current = prefs; }, [prefs]);
  useEffect(() => { permissionRef.current = permission; }, [permission]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    permissionRef.current = result;
  }, []);

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setLastSeenAtState(now);
    writeLastSeen(now);
    setUnreadCount(0);
  }, []);

  const sendTestNotification = useCallback(() => {
    if (permissionRef.current !== "granted") return;
    if (!prefsRef.current.enabled) return;
    const p = prefsRef.current;
    try {
      new Notification("NOC Monitor — آزمایش اعلان", {
        body: "سیستم اعلان‌های مرورگر به درستی کار می‌کند.",
        icon: "/favicon.ico",
        tag: `test-${Date.now()}`,
        requireInteraction: p.requireInteraction,
      });
    } catch {}
  }, []);

  const fireIncidentNotif = useCallback((
    id: number,
    title: string,
    body: string,
    severity: string,
    href: string,
    eventType: NotifEventType,
  ) => {
    const p = prefsRef.current;
    const perm = permissionRef.current;
    // Hard gate: disabled or no permission → never fire
    if (!p.enabled || perm !== "granted") return;
    if (!p.types.includes(eventType)) return;
    if (eventType === "incident_new" && !(p.severity as string[]).includes(severity)) return;
    if (shownIds.current.has(id) || readShownIds().has(id)) return;
    if (p.onlyWhenHidden && !document.hidden) return;
    shownIds.current.add(id);
    persistShownId(id);
    try {
      const n = new Notification(title, {
        body,
        icon: "/favicon.ico",
        tag: `noc-${eventType}-${id}`,
        requireInteraction: p.requireInteraction,
      });
      n.onclick = () => { window.focus(); window.location.href = href; };
    } catch {}
  }, []);

  const fireSweepNotif = useCallback((title: string, body: string, eventType: NotifEventType) => {
    const p = prefsRef.current;
    const perm = permissionRef.current;
    if (!p.enabled || perm !== "granted") return;
    if (!p.types.includes(eventType)) return;
    if (p.onlyWhenHidden && !document.hidden) return;
    try {
      new Notification(title, {
        body,
        icon: "/favicon.ico",
        tag: `noc-${eventType}-${Date.now()}`,
        requireInteraction: p.requireInteraction,
      });
    } catch {}
  }, []);

  const fetchRecent = useCallback(async () => {
    try {
      const resp = await fetch("/api/notifications/recent", { credentials: "include" });
      if (!resp.ok) return;
      const data: IncidentNotification[] = await resp.json();

      setRecentNotifications(data);

      const lastSeen = readLastSeen();
      const lastSeenDate = lastSeen ? new Date(lastSeen) : null;

      let newCount = 0;
      for (const notif of data) {
        const notifDate = new Date(notif.startedAt);
        if (lastSeenDate && notifDate <= lastSeenDate) continue;
        newCount++;

        // Only attempt notification if enabled and not yet shown
        if (prefsRef.current.enabled && !shownIds.current.has(notif.id)) {
          fireIncidentNotif(
            notif.id,
            `${notif.severity.toUpperCase()}: ${notif.siteName}`,
            notif.title,
            notif.severity,
            `/incidents/${notif.id}`,
            "incident_new",
          );
        }
      }

      setUnreadCount(newCount);
    } catch {}
  }, [fireIncidentNotif]);

  // SSE connection — only active when notifications are enabled and permission granted
  useEffect(() => {
    const notificationsActive = prefs.enabled && permission === "granted";
    if (!notificationsActive) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/notifications/stream", { withCredentials: true });

      es.onmessage = (event) => {
        // Extra guard: drop message if notifications were disabled mid-session
        if (!prefsRef.current.enabled) return;

        try {
          const payload = JSON.parse(event.data as string) as Record<string, unknown>;
          const type = payload.type as string;

          if (type === "incident_new") {
            const id = Number(payload.id);
            fireIncidentNotif(
              id,
              `${String(payload.severity ?? "").toUpperCase()}: ${String(payload.siteName ?? "")}`,
              String(payload.title ?? ""),
              String(payload.severity ?? ""),
              `/incidents/${id}`,
              "incident_new",
            );
            void fetchRecent();
          } else if (type === "incident_resolved") {
            const id = Number(payload.id);
            fireIncidentNotif(
              id,
              `Resolved: ${String(payload.siteName ?? "")}`,
              String(payload.title ?? ""),
              String(payload.severity ?? ""),
              `/incidents/${id}`,
              "incident_resolved",
            );
            void fetchRecent();
          } else if (type === "sweep_started") {
            fireSweepNotif(
              "بررسی شروع شد",
              `بررسی ${String(payload.siteCount ?? 0)} سایت آغاز شد`,
              "sweep_started",
            );
          } else if (type === "sweep_completed") {
            fireSweepNotif(
              "بررسی تمام شد",
              `بررسی ${String(payload.checked ?? 0)} از ${String(payload.siteCount ?? 0)} سایت انجام شد`,
              "sweep_completed",
            );
          }
        } catch {}
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, 10_000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  // Re-run when enabled state or permission changes — this closes/opens the SSE connection
  }, [prefs.enabled, permission, fetchRecent, fireIncidentNotif, fireSweepNotif]);

  // Polling fallback — always polls for unread count, but only fires notifications when enabled
  useEffect(() => {
    fetchRecent();
    const timer = setInterval(fetchRecent, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchRecent]);

  return (
    <NotificationsContext.Provider
      value={{
        prefs,
        setPrefs,
        permission,
        requestPermission,
        unreadCount,
        recentNotifications,
        markAllRead,
        lastSeenAt,
        sendTestNotification,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
