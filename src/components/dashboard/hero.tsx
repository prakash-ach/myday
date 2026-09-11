"use client";

import { useNow } from "@/lib/hooks/use-now";
import {
  formatClock,
  formatLongDate,
  greetingFor,
  meridiem,
  weekdayName,
} from "@/lib/time";

/**
 * The hero answers the first three questions of the morning: what time is
 * it, what day is it, and what is waiting. It deliberately isn't a card —
 * it sits directly on the canvas so the widgets below read as a separate
 * layer.
 *
 * Counts are passed in. Until Phase 3 wires up the database they arrive as
 * zeroes, which is honest: an empty day really does have nothing in it.
 */
export function Hero({
  name,
  taskCount = 0,
  doneCount = 0,
  reminderCount = 0,
}: {
  name?: string;
  taskCount?: number;
  doneCount?: number;
  reminderCount?: number;
}) {
  const now = useNow();

  // Rendered empty on the server: the server's clock is not the reader's
  // clock, and a mismatch would flash the wrong time on first paint.
  const greeting = now ? greetingFor(now) : "\u00a0";
  const clock = now ? formatClock(now) : "\u00a0";
  const ampm = now ? meridiem(now) : "";
  const weekday = now ? weekdayName(now) : "\u00a0";
  const date = now ? formatLongDate(now) : "\u00a0";

  return (
    <section className="px-1 pt-2 pb-8 sm:pt-6">
      <p className="text-ink-muted font-serif text-[19px] sm:text-[22px]">
        {greeting}
        {name ? `, ${name}` : ""}
      </p>

      <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-3 sm:mt-3">
        <h1 className="tnum text-[64px] leading-[0.9] font-light tracking-[-0.045em] sm:text-[88px]">
          {clock}
          <span className="text-ink-faint ml-2 align-top text-[20px] font-normal tracking-normal sm:text-[24px]">
            {ampm}
          </span>
        </h1>

        <div className="mb-1.5">
          <p className="text-[17px] font-medium sm:text-[19px]">{weekday}</p>
          <p className="text-ink-muted text-[13.5px]">{date}</p>
        </div>
      </div>

      <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 sm:mt-7 sm:gap-x-12">
        <Stat value={taskCount} label={taskCount === 1 ? "task today" : "tasks today"} />
        <Stat value={doneCount} label="completed" />
        <Stat
          value={reminderCount}
          label={reminderCount === 1 ? "reminder" : "reminders"}
        />
      </dl>
    </section>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="tnum text-[26px] leading-none font-medium sm:text-[30px]">
          {value}
        </span>
        <span className="text-ink-muted ml-2 text-[13.5px]">{label}</span>
      </dd>
    </div>
  );
}
