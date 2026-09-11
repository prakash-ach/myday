import { PageShell } from "@/components/shell/page-shell";
import { Empty } from "@/components/ui/empty";

export default function Page() {
  return (
    <PageShell title="Search" subtitle="One place to look across everything.">
      <Empty
        title="Search is coming in Phase 5"
        hint="It will cover tasks, notes, tags, categories and goals at once."
      />
    </PageShell>
  );
}
