import { I18nProvider } from "react-aria-components";
import { AppShell } from "./app/AppShell";
import { useI18n } from "./i18n";

/** 应用入口，挂载 AppShell。组件边界见 docs/development/frontend.md。 */
export function App() {
  const { locale } = useI18n();
  return (
    <I18nProvider locale={locale}>
      <AppShell />
    </I18nProvider>
  );
}
