import { PageShell } from "@/components/shell/page-shell";
import { Empty } from "@/components/ui/empty";

export default function Page() {
  return (
    <PageShell title="Habits" subtitle="The small things you want to keep doing.">
      <Empty
        title="No habits yet"
        hint="Track a daily streak for things like reading or the gym."
      />
    </PageShell>
  );
}
