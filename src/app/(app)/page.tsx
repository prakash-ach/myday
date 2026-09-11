import { Hero } from "@/components/dashboard/hero";
import { WidgetGrid } from "@/components/dashboard/widget-grid";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <>
      <Hero name="Prakash" />

      <WidgetGrid>
        <Card>
          <CardHeader title="Today" count={0} />
          <CardBody className="p-0">
            <Empty
              title="Nothing planned yet"
              hint="Tasks you schedule for today land here, in the order they happen."
              action={
                <Button size="sm" disabled>
                  Add a task
                </Button>
              }
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Schedule" />
          <CardBody className="p-0">
            <Empty
              title="No appointments"
              hint="Anything with a start time shows on a timeline here."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Overdue" count={0} />
          <CardBody className="p-0">
            <Empty title="Nothing overdue" hint="Good place to be." />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Notes" />
          <CardBody className="p-0">
            <Empty
              title="No notes yet"
              hint="Quick thoughts you jot down will show up here."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Goals" />
          <CardBody className="p-0">
            <Empty
              title="No goals set"
              hint="Longer-term things you're working toward, with progress."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Habits" />
          <CardBody className="p-0">
            <Empty title="No habits tracked" hint="Daily streaks, once you add a few." />
          </CardBody>
        </Card>
      </WidgetGrid>

      <p className="text-ink-faint mt-8 text-[12.5px]">
        Phase 1 of 15. The shell, theme and layout are real; tasks, notes and the rest
        connect to the database in the phases ahead.
      </p>
    </>
  );
}
