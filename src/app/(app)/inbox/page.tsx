import { PageShell } from "@/components/shell/page-shell";
import { Empty } from "@/components/ui/empty";

export default function Page() {
  return (
    <PageShell title="Inbox" subtitle="Catch things here now, sort them out later.">
      <Empty
        title="Inbox is clear"
        hint="Jot something down without deciding where it belongs yet."
      />
    </PageShell>
  );
}
