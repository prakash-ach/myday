import { PageShell } from "@/components/shell/page-shell";
import { Empty } from "@/components/ui/empty";

export default function Page() {
  return (
    <PageShell title="Calendar" subtitle="Day, week and month views of what's scheduled.">
      <Empty
        title="Nothing on the calendar"
        hint="Tasks with a date and time will appear here."
      />
    </PageShell>
  );
}
