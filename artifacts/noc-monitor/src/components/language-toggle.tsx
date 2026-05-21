import { useT } from "@/i18n/LanguageProvider";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, dir } = useT();
  const nextLabel = lang === "fa" ? "English" : "فارسی";
  const tooltip = lang === "fa" ? "Switch to English" : "تغییر به فارسی";

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="w-full"
            onClick={() => setLang(lang === "fa" ? "en" : "fa")}
            aria-label={tooltip}
          >
            <Languages className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={dir === "rtl" ? "left" : "right"}>
          {nextLabel}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-start gap-2"
      onClick={() => setLang(lang === "fa" ? "en" : "fa")}
      title={tooltip}
      aria-label="Toggle language"
    >
      <Languages className="h-4 w-4" />
      <span className="font-medium">{nextLabel}</span>
    </Button>
  );
}
