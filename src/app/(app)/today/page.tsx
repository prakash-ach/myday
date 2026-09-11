import { PageShell } from "@/components/shell/page-shell";
import { Empty } from "@/components/ui/empty";

export default function Page() {
  return (
    <PageShell title="Today" subtitle="Everything scheduled for the day, in order.">
      <Empty
        title="Nothing planned yet"
        hint="Enjoy the free time, or add something to the list."
      />
    </PageShell>
  );
}
