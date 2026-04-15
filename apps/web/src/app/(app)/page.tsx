"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import { motion, AnimatePresence } from "motion/react";
import {
  LogOut,
  Send,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Task {
  id: string;
  title: string;
  timeframe: "now" | "today" | "tomorrow";
  completed: boolean;
  goalId: string;
  time?: string;
  startTime?: string;
  endTime?: string;
}

interface Goal {
  id: string;
  title: string;
  color: string;
  progress: number;
  tasks: Task[];
}

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  text: string;
}

// ---------------------------------------------------------------------------
// Static demo data
// ---------------------------------------------------------------------------

const goals: Goal[] = [
  {
    id: "g1",
    title: "Learn Spanish",
    color: "#0a84ff",
    progress: 42,
    tasks: [
      {
        id: "t1",
        title: "Complete Duolingo lesson",
        timeframe: "now",
        completed: false,
        goalId: "g1",
        startTime: "9:00 AM",
        endTime: "9:15 AM",
      },
      {
        id: "t2",
        title: "Review 20 flashcards",
        timeframe: "today",
        completed: true,
        goalId: "g1",
        time: "10:00 AM",
      },
      {
        id: "t3",
        title: "Watch Spanish YouTube video",
        timeframe: "today",
        completed: false,
        goalId: "g1",
        time: "2:00 PM",
      },
      {
        id: "t4",
        title: "Practice speaking with AI",
        timeframe: "today",
        completed: false,
        goalId: "g1",
        time: "5:00 PM",
      },
      {
        id: "t5",
        title: "Write 5 sentences",
        timeframe: "tomorrow",
        completed: false,
        goalId: "g1",
      },
      {
        id: "t6",
        title: "Listen to podcast",
        timeframe: "tomorrow",
        completed: false,
        goalId: "g1",
      },
    ],
  },
  {
    id: "g2",
    title: "Run a Marathon",
    color: "#30d158",
    progress: 28,
    tasks: [
      {
        id: "t7",
        title: "Stretch for 10 minutes",
        timeframe: "today",
        completed: false,
        goalId: "g2",
        time: "7:00 AM",
      },
      {
        id: "t8",
        title: "Run 5km easy pace",
        timeframe: "today",
        completed: false,
        goalId: "g2",
        time: "7:30 AM",
      },
      {
        id: "t9",
        title: "Log nutrition",
        timeframe: "today",
        completed: true,
        goalId: "g2",
        time: "12:00 PM",
      },
      {
        id: "t10",
        title: "Rest day \u2014 light yoga",
        timeframe: "tomorrow",
        completed: false,
        goalId: "g2",
      },
    ],
  },
  {
    id: "g3",
    title: "Side Project",
    color: "#bf5af2",
    progress: 65,
    tasks: [
      {
        id: "t11",
        title: "Fix auth bug",
        timeframe: "today",
        completed: false,
        goalId: "g3",
        time: "9:00 AM",
      },
      {
        id: "t12",
        title: "Design pricing page",
        timeframe: "today",
        completed: false,
        goalId: "g3",
        time: "3:00 PM",
      },
      {
        id: "t13",
        title: "Write 3 API endpoints",
        timeframe: "tomorrow",
        completed: false,
        goalId: "g3",
      },
    ],
  },
  {
    id: "g4",
    title: "Read 24 Books",
    color: "#ff9f0a",
    progress: 50,
    tasks: [
      {
        id: "t14",
        title: "Read 30 pages",
        timeframe: "today",
        completed: false,
        goalId: "g4",
        time: "9:00 PM",
      },
      {
        id: "t15",
        title: "Write book notes",
        timeframe: "tomorrow",
        completed: false,
        goalId: "g4",
      },
    ],
  },
  {
    id: "g5",
    title: "Meditation",
    color: "#64d2ff",
    progress: 80,
    tasks: [
      {
        id: "t16",
        title: "Morning meditation 10 min",
        timeframe: "today",
        completed: true,
        goalId: "g5",
        time: "6:30 AM",
      },
      {
        id: "t17",
        title: "Evening reflection",
        timeframe: "tomorrow",
        completed: false,
        goalId: "g5",
      },
    ],
  },
];

const aiResponses = [
  "Great job staying consistent! You've completed 3 tasks already today. Keep the momentum going.",
  "Your marathon training is on track. Remember to hydrate well before your afternoon run.",
  "I noticed you finished your flashcards early today. Want me to schedule an extra Spanish practice session?",
  "Your side project is at 65% — you're in the home stretch. Focus on the auth bug first, it'll unblock the rest.",
  "You've meditated every day this week. That's a 7-day streak! Want to try extending to 15 minutes?",
  "Looking at your schedule, you have a gap between 1:00 and 2:00 PM. Want me to slot in some reading time?",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGoalById(id: string): Goal | undefined {
  return goals.find((g) => g.id === id);
}

function getAllTasks(): Task[] {
  return goals.flatMap((g) => g.tasks);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isDayToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

interface CalendarDay {
  date: Date;
  day: number;
  isCurrentMonth: boolean;
}

function getCalendarGrid(year: number, month: number): CalendarDay[] {
  const firstOfMonth = new Date(year, month, 1);
  // Monday=0 ... Sunday=6
  let startOffset = firstOfMonth.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  const startDate = new Date(year, month, 1 - startOffset);
  const days: CalendarDay[] = [];

  for (let i = 0; i < 42; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    days.push({
      date,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === month,
    });
  }
  return days;
}

// Scheduled tasks keyed by date string — demo data spread across the next 2 weeks
const SCHEDULED_TASKS: Record<
  string,
  Array<{ id: string; title: string; goalId: string; time?: string }>
> = (() => {
  const today = new Date();
  const key = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return toDateKey(d);
  };

  return {
    [key(1)]: [
      { id: "s1", title: "Write 5 sentences", goalId: "g1", time: "9:00 AM" },
      { id: "s2", title: "Listen to podcast", goalId: "g1", time: "12:00 PM" },
      { id: "s3", title: "Rest day — light yoga", goalId: "g2", time: "7:00 AM" },
      { id: "s4", title: "Write 3 API endpoints", goalId: "g3", time: "2:00 PM" },
      { id: "s5", title: "Write book notes", goalId: "g4", time: "8:00 PM" },
      { id: "s6", title: "Evening reflection", goalId: "g5", time: "9:30 PM" },
    ],
    [key(2)]: [
      { id: "s7", title: "Grammar practice", goalId: "g1", time: "10:00 AM" },
      { id: "s8", title: "Run 8km tempo", goalId: "g2", time: "6:30 AM" },
      { id: "s9", title: "Read 30 pages", goalId: "g4", time: "9:00 PM" },
    ],
    [key(4)]: [
      { id: "s10", title: "Spanish conversation class", goalId: "g1", time: "11:00 AM" },
      { id: "s11", title: "Long run 15km", goalId: "g2", time: "6:00 AM" },
      { id: "s12", title: "Deploy MVP", goalId: "g3", time: "3:00 PM" },
      { id: "s13", title: "Meditation 15 min", goalId: "g5", time: "7:00 AM" },
    ],
    [key(6)]: [
      { id: "s14", title: "Vocabulary review", goalId: "g1", time: "10:00 AM" },
      { id: "s15", title: "Cross training", goalId: "g2", time: "7:00 AM" },
    ],
    [key(8)]: [
      { id: "s16", title: "Watch Spanish movie", goalId: "g1", time: "7:00 PM" },
      { id: "s17", title: "Speed intervals", goalId: "g2", time: "6:30 AM" },
      { id: "s18", title: "User testing", goalId: "g3", time: "2:00 PM" },
      { id: "s19", title: "Read 30 pages", goalId: "g4", time: "9:00 PM" },
      { id: "s20", title: "Guided meditation", goalId: "g5", time: "7:00 AM" },
    ],
    [key(11)]: [
      { id: "s21", title: "Practice with tutor", goalId: "g1", time: "4:00 PM" },
      { id: "s22", title: "Half marathon practice", goalId: "g2", time: "6:00 AM" },
    ],
    [key(13)]: [
      { id: "s23", title: "Write blog post", goalId: "g3", time: "10:00 AM" },
      { id: "s24", title: "Book club meeting", goalId: "g4", time: "6:00 PM" },
    ],
    [key(15)]: [
      { id: "s25", title: "Spanish test prep", goalId: "g1", time: "9:00 AM" },
      { id: "s26", title: "Recovery run 5km", goalId: "g2", time: "7:00 AM" },
      { id: "s27", title: "Ship feature", goalId: "g3", time: "1:00 PM" },
    ],
  };
})();

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];

const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08 },
  },
};

const sectionVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: easeOutExpo },
  },
};

// ---------------------------------------------------------------------------
// Section Label
// ---------------------------------------------------------------------------

function SectionLabel({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <span
        className="font-heading text-[0.6875rem] font-medium uppercase text-muted-foreground"
        style={{ letterSpacing: "0.1em" }}
      >
        {children}
      </span>
      {right && (
        <span className="text-[0.75rem] text-muted-foreground tabular-nums">
          {right}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Now Section
// ---------------------------------------------------------------------------

function NowSection() {
  const nowTask = getAllTasks().find((t) => t.timeframe === "now");
  const [secondsLeft, setSecondsLeft] = useState(15 * 60);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    if (completed) return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [completed]);

  if (!nowTask) return null;

  const goal = getGoalById(nowTask.goalId);
  if (!goal) return null;

  const totalSeconds = 15 * 60;
  const elapsed = totalSeconds - secondsLeft;
  const progress = (elapsed / totalSeconds) * 100;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <div>
      <SectionLabel right={`${nowTask.startTime} – ${nowTask.endTime}`}>
        Now
      </SectionLabel>

      {/* Timer */}
      <p
        className="font-heading text-[3rem] font-light tracking-tight text-foreground leading-none"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </p>

      {/* Task */}
      <div className="mt-5 flex items-start gap-3.5">
        <button
          type="button"
          onClick={() => setCompleted(!completed)}
          className="mt-0.5 w-[1.375rem] h-[1.375rem] rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0 transition-all duration-200"
          style={{
            borderColor: goal.color,
            backgroundColor: completed ? goal.color : "transparent",
          }}
        >
          {completed && (
            <Check
              size={12}
              strokeWidth={2.5}
              className="text-background"
            />
          )}
        </button>

        <div className="min-w-0">
          <p
            className={`text-[1.0625rem] font-medium text-foreground leading-snug transition-all duration-200 ${
              completed ? "line-through opacity-40" : ""
            }`}
          >
            {nowTask.title}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: goal.color }}
            />
            <span className="text-[0.8125rem] text-muted-foreground">
              {goal.title}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-6 h-[3px] rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: goal.color }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.8, ease: easeOutExpo }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Today Section
// ---------------------------------------------------------------------------

function TodaySection() {
  const todayTasks = getAllTasks().filter((t) => t.timeframe === "today");
  const [taskStates, setTaskStates] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const t of todayTasks) {
      map[t.id] = t.completed;
    }
    return map;
  });

  const completedCount = Object.values(taskStates).filter(Boolean).length;
  const totalCount = todayTasks.length;

  const toggleTask = (id: string) => {
    setTaskStates((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div>
      <SectionLabel right={`${completedCount}/${totalCount}`}>
        Today
      </SectionLabel>
      <p className="text-[0.8125rem] text-muted-foreground mb-3">
        {formatDate(new Date())}
      </p>

      <div className="flex flex-col">
        {todayTasks.map((task) => {
          const goal = getGoalById(task.goalId);
          const isCompleted = taskStates[task.id] ?? false;

          return (
            <div
              key={task.id}
              onClick={() => toggleTask(task.id)}
              className={`flex items-center gap-3 py-2.5 px-2 -mx-2 rounded-md cursor-pointer transition-colors duration-150 hover:bg-card ${
                isCompleted ? "opacity-40" : ""
              }`}
            >
              {/* Time */}
              <span
                className="text-[0.75rem] w-[4.5rem] flex-shrink-0 tabular-nums"
                style={{ color: "oklch(40% 0.006 270)" }}
              >
                {task.time}
              </span>

              {/* Color dot */}
              <div
                className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                style={{ backgroundColor: goal?.color ?? "oklch(35% 0 270)" }}
              />

              {/* Checkbox */}
              <div
                className="w-[1.125rem] h-[1.125rem] rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0 transition-colors duration-150"
                style={{
                  borderColor: goal?.color ?? "oklch(35% 0 270)",
                  backgroundColor: isCompleted
                    ? goal?.color ?? "oklch(35% 0 270)"
                    : "transparent",
                }}
              >
                {isCompleted && (
                  <Check
                    size={10}
                    strokeWidth={3}
                    className="text-background"
                  />
                )}
              </div>

              {/* Title */}
              <span
                className={`text-[0.9375rem] text-foreground flex-1 ${
                  isCompleted ? "line-through" : ""
                }`}
              >
                {task.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Goals Section
// ---------------------------------------------------------------------------

function GoalsSection() {
  return (
    <div>
      <SectionLabel>Goals</SectionLabel>

      <div
        className="-mx-5 px-5 flex gap-3 overflow-x-auto pb-1"
        style={{ scrollbarWidth: "none" }}
      >
        {goals.map((goal, i) => (
          <div
            key={goal.id}
            title={goal.title}
            className="flex-shrink-0 w-[136px] rounded-xl p-4"
            style={{
              border: `1px solid color-mix(in oklch, ${goal.color} 15%, transparent)`,
            }}
          >
            <span className="text-[0.8125rem] text-foreground/85 truncate block leading-tight">
              {goal.title}
            </span>

            <p
              className="text-[1.125rem] font-semibold tabular-nums mt-2.5 leading-none"
              style={{ color: goal.color }}
            >
              {goal.progress}%
            </p>

            <div className="mt-3 h-[3px] rounded-full bg-muted overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: goal.color }}
                initial={{ width: 0 }}
                animate={{ width: `${goal.progress}%` }}
                transition={{
                  duration: 0.8,
                  delay: 0.2 + i * 0.05,
                  ease: easeOutExpo,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule / Calendar Section
// ---------------------------------------------------------------------------

const DAY_HEADERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function ScheduleSection() {
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }, []);

  const [selectedDate, setSelectedDate] = useState(tomorrow);
  const [viewMonth, setViewMonth] = useState(tomorrow.getMonth());
  const [viewYear, setViewYear] = useState(tomorrow.getFullYear());

  const calendarDays = useMemo(
    () => getCalendarGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const selectedTasks = SCHEDULED_TASKS[toDateKey(selectedDate)] ?? [];

  const goToPrevMonth = () => {
    setViewMonth((m) => {
      if (m === 0) {
        setViewYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  };

  const goToNextMonth = () => {
    setViewMonth((m) => {
      if (m === 11) {
        setViewYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  };

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div>
      <SectionLabel>Schedule</SectionLabel>

      <div className="flex flex-col sm:flex-row gap-6">
        {/* Day detail — left on desktop, bottom on mobile */}
        <div className="flex-1 min-w-0 order-2 sm:order-1">
          <p className="text-[0.9375rem] text-foreground font-medium mb-0.5">
            {selectedDate.toLocaleDateString("en-US", {
              weekday: "long",
              month: "short",
              day: "numeric",
            })}
          </p>
          <p className="text-[0.75rem] text-muted-foreground mb-4">
            {selectedTasks.length}{" "}
            {selectedTasks.length === 1 ? "task" : "tasks"} scheduled
          </p>

          {selectedTasks.length > 0 ? (
            <div className="flex flex-col gap-2">
              {selectedTasks.map((task) => {
                const goal = getGoalById(task.goalId);
                return (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 py-1.5"
                  >
                    {task.time && (
                      <span
                        className="text-[0.75rem] w-[4.5rem] flex-shrink-0 tabular-nums"
                        style={{ color: "oklch(40% 0.006 270)" }}
                      >
                        {task.time}
                      </span>
                    )}
                    <div
                      className="w-[6px] h-[6px] rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: goal?.color ?? "oklch(35% 0 270)",
                      }}
                    />
                    <span className="text-[0.875rem] text-foreground/80">
                      {task.title}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[0.875rem] text-muted-foreground/50 italic">
              Nothing planned for this day
            </p>
          )}
        </div>

        {/* Calendar — right on desktop, top on mobile */}
        <div className="w-full sm:w-[264px] flex-shrink-0 order-1 sm:order-2">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2">
            <span className="text-[0.8125rem] text-foreground font-medium">
              {monthLabel}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={goToPrevMonth}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card transition-colors duration-150"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={goToNextMonth}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card transition-colors duration-150"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-0.5">
            {DAY_HEADERS.map((d) => (
              <div
                key={d}
                className="text-center text-[0.6875rem] text-muted-foreground/60 py-1 font-medium"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {calendarDays.map((calDay, i) => {
              const key = toDateKey(calDay.date);
              const dayTasks = SCHEDULED_TASKS[key] ?? [];
              const isSelected = isSameDay(calDay.date, selectedDate);
              const isTodayCell = isDayToday(calDay.date);

              // Unique goal colors for indicator dots
              const goalColors = [
                ...new Set(
                  dayTasks
                    .map((t) => getGoalById(t.goalId)?.color)
                    .filter(Boolean),
                ),
              ] as string[];

              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedDate(new Date(calDay.date))}
                  className={`relative flex flex-col items-center py-1.5 rounded-md transition-colors duration-100 ${
                    !calDay.isCurrentMonth ? "opacity-20 pointer-events-none" : ""
                  } ${
                    isSelected
                      ? "bg-foreground text-background"
                      : isTodayCell
                        ? "text-foreground"
                        : "text-foreground/60 hover:bg-card"
                  }`}
                >
                  <span
                    className={`text-[0.75rem] tabular-nums leading-none ${
                      isTodayCell && !isSelected ? "font-semibold" : ""
                    }`}
                  >
                    {calDay.day}
                  </span>

                  {/* Task indicator dots */}
                  <div className="flex gap-[2px] mt-1 h-1">
                    {goalColors.slice(0, 3).map((color, ci) => (
                      <div
                        key={ci}
                        className="w-1 h-1 rounded-full"
                        style={{
                          backgroundColor: isSelected
                            ? "var(--background)"
                            : color,
                        }}
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Chat Section
// ---------------------------------------------------------------------------

function AIChatSection() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "m0",
      role: "ai",
      text: "You've got a solid day ahead. Your Duolingo lesson is up first — want me to adjust anything?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgCounter = useRef(1);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    const userMsg: ChatMessage = {
      id: `m${msgCounter.current++}`,
      role: "user",
      text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    setTimeout(() => {
      const aiText =
        aiResponses[Math.floor(Math.random() * aiResponses.length)];
      const aiMsg: ChatMessage = {
        id: `m${msgCounter.current++}`,
        role: "ai",
        text: aiText,
      };
      setMessages((prev) => [...prev, aiMsg]);
      setIsTyping(false);
    }, 1200 + Math.random() * 800);
  };

  return (
    <div>
      <SectionLabel>Assistant</SectionLabel>

      <div className="rounded-xl bg-card overflow-hidden">
        {/* Messages */}
        <div
          ref={scrollRef}
          className="max-h-[200px] overflow-y-auto px-5 py-4 space-y-3"
        >
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: easeOutExpo }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] text-[0.9375rem] leading-relaxed ${
                  msg.role === "user"
                    ? "px-3.5 py-2.5 rounded-lg bg-muted text-foreground"
                    : "text-foreground/80"
                }`}
              >
                {msg.text}
              </div>
            </motion.div>
          ))}

          {/* Typing indicator — breathing dots, no bounce */}
          <AnimatePresence>
            {isTyping && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex gap-1.5 pt-1"
              >
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-foreground/30"
                    animate={{ opacity: [0.2, 0.7, 0.2] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      delay: i * 0.2,
                      ease: "easeInOut",
                    }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Input bar */}
        <div className="px-3 pb-3 pt-1">
          <div className="flex items-center gap-3 rounded-lg bg-background px-3.5 py-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask anything..."
              className="flex-1 bg-transparent text-[0.9375rem] text-foreground placeholder:text-muted-foreground/50 outline-none"
            />
            <button
              type="button"
              onClick={handleSend}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors duration-150"
            >
            <Send size={15} />
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile Dropdown
// ---------------------------------------------------------------------------

function ProfileDropdown({
  userName,
  userEmail,
}: {
  userName: string;
  userEmail: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [open]);

  const initial = (userName || userEmail || "?")[0].toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    router.push("/sign-in");
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-8 h-8 rounded-full flex items-center justify-center text-[0.8125rem] font-medium text-foreground transition-colors duration-150"
        style={{ backgroundColor: "oklch(22% 0.005 270)" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.backgroundColor =
            "oklch(26% 0.005 270)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.backgroundColor =
            "oklch(22% 0.005 270)")
        }
      >
        {initial}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15, ease: easeOutExpo }}
            className="absolute right-0 top-11 w-52 rounded-lg bg-popover border border-border p-3 z-50"
          >
            <p className="text-[0.8125rem] text-foreground font-medium truncate">
              {userName}
            </p>
            <p className="text-[0.75rem] text-muted-foreground truncate mb-3">
              {userEmail}
            </p>

            <button
              type="button"
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-[0.8125rem] font-normal text-foreground hover:bg-card transition-colors duration-150"
            >
              <LogOut size={14} className="text-muted-foreground" />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/sign-in");
    }
  }, [isPending, session, router]);

  if (isPending || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  const userName = session.user.name || session.user.email || "User";
  const userEmail = session.user.email || "";

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/70 backdrop-blur-2xl border-b border-border/50">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-5 h-14">
          <span className="font-heading text-[0.9375rem] font-semibold tracking-tight">
            Consistent
          </span>
          <ProfileDropdown userName={userName} userEmail={userEmail} />
        </div>
      </header>

      {/* Dashboard */}
      <motion.main
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="max-w-2xl mx-auto px-5 pt-8 pb-24"
      >
        <motion.section variants={sectionVariants}>
          <NowSection />
        </motion.section>

        <motion.section variants={sectionVariants} className="pt-8">
          <AIChatSection />
        </motion.section>

        <motion.section variants={sectionVariants} className="pt-6">
          <GoalsSection />
        </motion.section>

        <motion.section variants={sectionVariants} className="pt-10">
          <TodaySection />
        </motion.section>

        <motion.section variants={sectionVariants} className="pt-12">
          <ScheduleSection />
        </motion.section>
      </motion.main>
    </div>
  );
}
