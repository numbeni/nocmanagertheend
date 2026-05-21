import { useEffect, useRef } from "react";
import {
  useGetAppSettings,
  getGetAppSettingsQueryKey,
} from "@workspace/api-client-react";
import { useTheme } from "./ThemeProvider";

/**
 * Synchronises the locally-cached theme with the operator-controlled
 * `themeMode` setting served by the API. Once the server responds the local
 * cache is updated so the choice survives across browsers/devices.
 */
export function ThemeBridge() {
  const { theme, setTheme } = useTheme();
  const { data } = useGetAppSettings({
    query: {
      queryKey: getGetAppSettingsQueryKey(),
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  });
  const lastApplied = useRef<string | null>(null);

  useEffect(() => {
    const remote = data?.themeMode;
    if (!remote) return;
    if (remote !== "dark" && remote !== "light") return;
    // Only override the local theme if the server value actually changed —
    // this lets the operator flip themes locally without the bridge fighting
    // them on every render.
    if (lastApplied.current === remote) return;
    lastApplied.current = remote;
    if (remote !== theme) setTheme(remote);
  }, [data?.themeMode, theme, setTheme]);

  return null;
}
