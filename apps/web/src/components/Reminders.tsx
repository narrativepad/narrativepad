"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { readReminders, saveReminders, useReminders, type Reminder } from "@/lib/client/local";
import { Icon } from "./bits";
import { useToast } from "./Providers";

const notificationsOn = () => typeof Notification !== "undefined" && Notification.permission === "granted";

/** Fires saved reminders while any narrativepad tab is open (browser notification + in-page toast). */
export function ReminderRunner() {
  const list = useReminders();
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    const timers = list.map((r) =>
      setTimeout(
        () => {
          saveReminders(readReminders().filter((x) => x.id !== r.id));
          toast("info", `${r.title}: ${r.label}`);
          if (notificationsOn()) {
            const n = new Notification(`${r.title} · narrativepad`, { body: r.label, tag: r.id });
            n.onclick = () => {
              window.focus();
              router.push(`/n/${r.slug}`);
            };
          }
        },
        Math.max(0, r.at - Date.now()),
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [list, toast, router]);
  return null;
}

/** Bell toggle for one deadline on one coin. Fires `leadSec` before `deadline`. */
export function RemindButton({
  narrativeId,
  slug,
  title,
  deadline,
  what,
  leadSec = 60,
}: {
  narrativeId: string;
  slug: string;
  title: string;
  deadline: string;
  what: "vote" | "pool" | "launch";
  leadSec?: number;
}) {
  const toast = useToast();
  const list = useReminders();
  const id = `${narrativeId}:${what}`;
  const on = list.some((r) => r.id === id);
  const end = Date.parse(deadline);
  if (end <= Date.now()) return null;

  const label = what === "vote" ? "Voting ends in 1 minute" : what === "pool" ? "The pool closes in 1 minute" : "Launching in a moment";
  async function toggle() {
    const now = readReminders();
    if (on) {
      saveReminders(now.filter((r) => r.id !== id));
      return toast("info", "Reminder removed");
    }
    let granted = notificationsOn();
    if (!granted && typeof Notification !== "undefined" && Notification.permission === "default") {
      granted = (await Notification.requestPermission()) === "granted";
    }
    const reminder: Reminder = { id, slug, title, at: Math.max(Date.now() + 1000, end - leadSec * 1000), label };
    saveReminders([...now.filter((r) => r.id !== id), reminder]);
    toast(
      "ok",
      granted ? "We'll notify you in this browser while narrativepad is open" : "Notifications are blocked, so you'll get an alert on this page instead",
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={`btn h-9 px-3.5 text-[0.82rem] ${on ? "border-accent/40 bg-accent/10 text-accent hover:bg-accent/15" : ""}`}
      title={on ? "Remove reminder" : label.replace("in 1 minute", "soon")}
    >
      <Icon name="bell" className="h-4 w-4" />
      {on ? "Reminder set" : "Remind me"}
    </button>
  );
}
