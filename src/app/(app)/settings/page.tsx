import { PageShell } from "@/components/shell/page-shell";
import { Empty } from "@/components/ui/empty";

export default function Page() {
  return (
    <PageShell title="Settings" subtitle="Make it yours.">
      <Empty
        title="Settings arrive in Phase 9"
        hint="Theme, accent colour, layout, weather location and notification choices."
      />
    </PageShell>
  );
}
