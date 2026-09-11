import { PageShell } from "@/components/shell/page-shell";
import { Empty } from "@/components/ui/empty";

export default function Page() {
  return (
    <PageShell title="Goals" subtitle="Bigger things, broken into milestones.">
      <Empty title="No goals yet" hint="Set a target date and track progress toward it." />
    </PageShell>
  );
}
