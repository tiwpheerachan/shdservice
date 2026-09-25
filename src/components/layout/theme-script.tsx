import { THEME_SCRIPT } from "@/lib/theme-script-source";
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
