import { PageShell } from "@/components/shell/page-shell";
import { Empty } from "@/components/ui/empty";

export default function Page() {
  return (
    <PageShell title="Tasks" subtitle="Every task, filtered how you like.">
      <Empty
        title="No tasks yet"
        hint="Once tasks exist you can filter by date, priority, category or tag."
      />
    </PageShell>
  );
}
