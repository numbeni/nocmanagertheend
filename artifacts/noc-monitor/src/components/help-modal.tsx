import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Keyboard, BookOpen } from "lucide-react";
import { useT } from "@/i18n/LanguageProvider";

const DISMISSED_KEY = "noc.help.dismissed";
const SEEN_KEY = "noc.help.seen";

interface ShortcutRow {
  key: string;
  label: string;
}

interface ShortcutGroup {
  groupKey: string;
  rows: ShortcutRow[];
}

function KbdBadge({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[1.6rem] h-6 px-1.5 text-[11px] font-mono font-semibold border border-border/70 rounded bg-muted shadow-sm text-foreground/80"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

interface OnboardingStep {
  titleKey: string;
  descKey: string;
  icon: string;
}

const STEPS: OnboardingStep[] = [
  { titleKey: "help.step1.title", descKey: "help.step1.desc", icon: "📊" },
  { titleKey: "help.step2.title", descKey: "help.step2.desc", icon: "🌐" },
  { titleKey: "help.step3.title", descKey: "help.step3.desc", icon: "📋" },
  { titleKey: "help.step4.title", descKey: "help.step4.desc", icon: "🚨" },
  { titleKey: "help.step5.title", descKey: "help.step5.desc", icon: "📈" },
  { titleKey: "help.step6.title", descKey: "help.step6.desc", icon: "💳" },
  { titleKey: "help.step7.title", descKey: "help.step7.desc", icon: "🔬" },
  { titleKey: "help.step8.title", descKey: "help.step8.desc", icon: "👥" },
  { titleKey: "help.step9.title", descKey: "help.step9.desc", icon: "⌨️" },
];

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  const { t } = useT();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const shortcutGroups: ShortcutGroup[] = [
    {
      groupKey: "shortcuts.group.navigation",
      rows: [
        { key: t("shortcuts.toggleSidebar"), label: "S" },
        { key: t("shortcuts.toggleLanguage"), label: "T" },
      ],
    },
    {
      groupKey: "shortcuts.group.view",
      rows: [
        { key: t("shortcuts.fullscreen"), label: "F" },
        { key: t("shortcuts.gridView"), label: "G" },
        { key: t("shortcuts.listView"), label: "L" },
      ],
    },
    {
      groupKey: "shortcuts.group.monitoring",
      rows: [
        { key: t("shortcuts.pauseResume"), label: "P" },
        { key: t("shortcuts.refresh"), label: "R" },
      ],
    },
    {
      groupKey: "shortcuts.group.general",
      rows: [
        { key: t("shortcuts.help"), label: "?" },
        { key: t("shortcuts.close"), label: "Esc" },
      ],
    },
  ];

  function handleClose() {
    if (dontShowAgain) {
      try {
        localStorage.setItem(DISMISSED_KEY, "1");
      } catch { /* ignore */ }
    }
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            {t("help.title")}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="guide" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="shrink-0">
            <TabsTrigger value="guide">
              <BookOpen className="h-3.5 w-3.5 mr-1.5" />
              {t("help.tabs.gettingStarted")}
            </TabsTrigger>
            <TabsTrigger value="shortcuts">
              <Keyboard className="h-3.5 w-3.5 mr-1.5" />
              {t("help.tabs.shortcuts")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="guide" className="flex-1 min-h-0 overflow-y-auto mt-4">
            <div className="space-y-3">
              {STEPS.map((step, i) => (
                <div
                  key={i}
                  className="flex gap-3 p-3 rounded-lg bg-muted/40 border border-border/40"
                >
                  <div className="text-2xl leading-none mt-0.5 shrink-0">{step.icon}</div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono shrink-0">
                        {i + 1}
                      </Badge>
                      {t(step.titleKey)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {t(step.descKey)}
                    </p>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground/70 text-center pt-1">
                {t("help.reopenHint")}
              </p>
            </div>
          </TabsContent>

          <TabsContent value="shortcuts" className="flex-1 min-h-0 overflow-y-auto mt-4">
            <div className="space-y-4">
              {shortcutGroups.map((group) => (
                <div key={group.groupKey}>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {t(group.groupKey)}
                  </div>
                  <div className="space-y-1">
                    {group.rows.map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/40 transition-colors"
                      >
                        <span className="text-sm">{row.key}</span>
                        <KbdBadge keys={[row.label]} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between pt-3 border-t border-border/50 shrink-0">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground">
            <Checkbox
              checked={dontShowAgain}
              onCheckedChange={(v) => setDontShowAgain(v === true)}
            />
            {t("help.dontShowAgain")}
          </label>
          <Button size="sm" onClick={handleClose}>
            {t("help.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function useAutoShowHelp(): { showHelp: boolean; setShowHelp: (v: boolean) => void } {
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    try {
      const dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
      const seen = localStorage.getItem(SEEN_KEY) === "1";
      if (!dismissed && !seen) {
        localStorage.setItem(SEEN_KEY, "1");
        setTimeout(() => setShowHelp(true), 1200);
      }
    } catch { /* ignore */ }
  }, []);

  return { showHelp, setShowHelp };
}
