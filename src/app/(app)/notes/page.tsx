import { PageShell } from "@/components/shell/page-shell";
import { Empty } from "@/components/ui/empty";

export default function Page() {
  return (
    <PageShell title="Notes" subtitle="Written things, searchable and taggable.">
      <Empty
        title="No notes yet"
        hint="Longer thoughts live here, and any note can become a task."
      />
    </PageShell>
  );
}
