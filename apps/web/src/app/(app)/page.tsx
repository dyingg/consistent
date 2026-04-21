"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useRealtime } from "@/lib/use-realtime";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  LogOut,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  TriangleAlert,
} from "lucide-react";
import { Coach } from "@/components/coach/coach";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GoalData {
  id: number;
  title: string;
  color: string | null;
  progress: number;
  totalTasks: number;
  completedTasks: number;
}

interface EnrichedBlock {
  id: number;
  taskId: number;
  startTime: string;
  endTime: string;
  status: string;
  scheduledBy: string;
  createdAt: string;
  task: {
    id: number;
    title: string;
    description: string | null;
    status: string;
    goalId: number;
  };
  goal: {
    id: number;
    title: string;
    color: string | null;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
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

// ---------------------------------------------------------------------------
// Date range helpers
// ---------------------------------------------------------------------------

function startOfDay(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfDay(date: Date): string {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];

const OVERDUE_COLOR = "oklch(62% 0.18 25)";

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
// Task-completion mutation — single source of truth.
//
// Why this lives at the page level and not per-component: every surface that
// flips a task's status (Now hero, Overdue hero, Today list) writes into the
// SAME React Query cache entries. Components subscribe to the cache for
// display. Realtime `task:updated` events funnel through the same cache via
// invalidation. No component-local override maps — those go stale the moment
// another surface or a socket event changes the same task.
// ---------------------------------------------------------------------------

function useToggleTaskStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      completed,
    }: {
      taskId: number;
      completed: boolean;
    }) =>
      api.tasks.update(taskId, {
        status: completed ? "completed" : "scheduled",
      }),
    onMutate: async ({ taskId, completed }) => {
      // Cancel in-flight refetches on the focused caches so they can't
      // overwrite the optimistic value mid-mutation.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["schedule", "today"] }),
        queryClient.cancelQueries({ queryKey: ["schedule", "now"] }),
      ]);

      const snapshotToday = queryClient.getQueryData<EnrichedBlock[]>([
        "schedule",
        "today",
      ]);
      const snapshotNow = queryClient.getQueryData<EnrichedBlock | null>([
        "schedule",
        "now",
      ]);

      const newStatus = completed ? "completed" : "scheduled";

      if (snapshotToday) {
        queryClient.setQueryData<EnrichedBlock[]>(
          ["schedule", "today"],
          snapshotToday.map((b) =>
            b.task.id === taskId
              ? { ...b, task: { ...b.task, status: newStatus } }
              : b,
          ),
        );
      }

      if (snapshotNow && snapshotNow.task.id === taskId) {
        queryClient.setQueryData<EnrichedBlock | null>(["schedule", "now"], {
          ...snapshotNow,
          task: { ...snapshotNow.task, status: newStatus },
        });
      }

      return { snapshotToday, snapshotNow };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshotToday !== undefined) {
        queryClient.setQueryData(
          ["schedule", "today"],
          context.snapshotToday,
        );
      }
      if (context?.snapshotNow !== undefined) {
        queryClient.setQueryData(["schedule", "now"], context.snapshotNow);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Now Section
// ---------------------------------------------------------------------------

function NowSection() {
  const { data: block, isLoading } = useQuery({
    queryKey: ["schedule", "now"],
    queryFn: () => api.schedule.now(),
    refetchInterval: 30_000,
  });

  const [secondsLeft, setSecondsLeft] = useState(0);
  const toggleMutation = useToggleTaskStatus();

  useEffect(() => {
    if (!block) return;
    const end = new Date(block.endTime).getTime();
    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [block]);

  if (isLoading) return null;
  if (!block) return <OverdueHero />;

  const isCompleted = block.task.status === "completed";
  const start = new Date(block.startTime).getTime();
  const end = new Date(block.endTime).getTime();
  const totalSeconds = Math.floor((end - start) / 1000);
  const elapsed = totalSeconds - secondsLeft;
  const progress = totalSeconds > 0 ? (elapsed / totalSeconds) * 100 : 0;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  const goalColor = block.goal.color ?? "oklch(50% 0.15 270)";

  return (
    <div>
      <SectionLabel right={`${formatTime(block.startTime)} – ${formatTime(block.endTime)}`}>
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
          onClick={() =>
            toggleMutation.mutate({
              taskId: block.task.id,
              completed: !isCompleted,
            })
          }
          className="mt-0.5 w-[1.375rem] h-[1.375rem] rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0 transition-all duration-200"
          style={{
            borderColor: goalColor,
            backgroundColor: isCompleted ? goalColor : "transparent",
          }}
        >
          {isCompleted && (
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
              isCompleted ? "line-through opacity-40" : ""
            }`}
          >
            {block.task.title}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: goalColor }}
            />
            <span className="text-[0.8125rem] text-muted-foreground">
              {block.goal.title}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-6 h-[3px] rounded-full bg-muted overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: goalColor }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.8, ease: easeOutExpo }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overdue Hero (fallback when Now has no active block)
// ---------------------------------------------------------------------------

function formatOverdue(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "<1m overdue";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m overdue`;
  if (minutes === 0) return `${hours}h overdue`;
  return `${hours}h ${minutes}m overdue`;
}

function OverdueHero() {
  const today = useMemo(() => new Date(), []);
  const shouldReduceMotion = useReducedMotion();
  // `justTapped` is an animation-only flag: it drives the check-pop + line-
  // through during the 350ms gap between tap and the optimistic cache write.
  // Task status itself lives in the cache — never mirror server truth here.
  const [justTapped, setJustTapped] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { data: todayBlocks = [] } = useQuery({
    queryKey: ["schedule", "today"],
    queryFn: () => api.schedule.blocks(startOfDay(today), endOfDay(today)),
  });

  const overdueBlocks = useMemo(() => {
    return (todayBlocks as EnrichedBlock[])
      .filter(
        (b) =>
          b.task.status !== "completed" &&
          new Date(b.endTime).getTime() < nowTick,
      )
      .sort(
        (a, b) =>
          new Date(a.endTime).getTime() - new Date(b.endTime).getTime(),
      );
  }, [todayBlocks, nowTick]);

  const firstId = overdueBlocks[0]?.task.id;

  useEffect(() => {
    setJustTapped(false);
  }, [firstId]);

  const toggleMutation = useToggleTaskStatus();

  const first = overdueBlocks[0];
  const goalColor = first?.goal.color ?? "oklch(50% 0.15 270)";
  const overdueMs = first ? nowTick - new Date(first.endTime).getTime() : 0;
  const overdueLabel = formatOverdue(overdueMs);
  const moreCount = Math.max(0, overdueBlocks.length - 1);

  const container = shouldReduceMotion
    ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 8 },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            duration: 0.5,
            ease: easeOutExpo,
            staggerChildren: 0.07,
            delayChildren: 0.04,
          },
        },
      };

  const item = shouldReduceMotion
    ? { hidden: { opacity: 1 }, visible: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 6 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.5, ease: easeOutExpo },
        },
      };

  const exit = shouldReduceMotion
    ? { opacity: 0, transition: { duration: 0.15 } }
    : {
        opacity: 0,
        y: -6,
        scale: 0.985,
        transition: { duration: 0.3, ease: easeOutExpo },
      };

  return (
    <AnimatePresence mode="wait">
      {first && (
        <motion.div
          key={first.id}
          variants={container}
          initial="hidden"
          animate="visible"
          exit={exit}
        >
          <motion.div variants={item}>
            <SectionLabel
              right={`${formatTime(first.startTime)} – ${formatTime(first.endTime)}`}
            >
              Overdue
            </SectionLabel>
          </motion.div>

          {/* Overdue duration — occupies the Now countdown's slot */}
          <motion.p
            variants={item}
            className="font-heading text-[3rem] font-light tracking-tight leading-none"
            style={{
              fontVariantNumeric: "tabular-nums",
              color: OVERDUE_COLOR,
            }}
          >
            {overdueLabel}
          </motion.p>

          {/* Task row — mirrors Now */}
          <motion.div variants={item} className="mt-5 flex items-start gap-3.5">
            <button
              type="button"
              disabled={justTapped}
              onClick={() => {
                if (justTapped) return;
                setJustTapped(true);
                window.setTimeout(() => {
                  toggleMutation.mutate({
                    taskId: first.task.id,
                    completed: true,
                  });
                }, 350);
              }}
              className="mt-0.5 w-[1.375rem] h-[1.375rem] rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0 transition-all duration-200 disabled:cursor-default"
              style={{
                borderColor: goalColor,
                backgroundColor: justTapped ? goalColor : "transparent",
              }}
            >
              {justTapped && (
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
                  justTapped ? "line-through opacity-40" : ""
                }`}
              >
                {first.task.title}
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: goalColor }}
                />
                <span className="text-[0.8125rem] text-muted-foreground">
                  {first.goal.title}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Fully-expended progress bar */}
          <motion.div
            variants={item}
            className="mt-6 h-[3px] rounded-full bg-muted overflow-hidden"
          >
            <motion.div
              className="h-full rounded-full"
              style={{ backgroundColor: OVERDUE_COLOR }}
              initial={{ width: 0 }}
              animate={{ width: "100%" }}
              transition={{
                duration: shouldReduceMotion ? 0 : 0.8,
                delay: shouldReduceMotion ? 0 : 0.35,
                ease: easeOutExpo,
              }}
            />
          </motion.div>

          {moreCount > 0 && (
            <motion.p
              variants={item}
              className="mt-3 text-[0.75rem] text-muted-foreground tabular-nums"
            >
              +{moreCount} more overdue
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Today Section
// ---------------------------------------------------------------------------

function TodaySection() {
  const today = useMemo(() => new Date(), []);
  const shouldReduceMotion = useReducedMotion();
  const { data: blocks = [] } = useQuery({
    queryKey: ["schedule", "today"],
    queryFn: () => api.schedule.blocks(startOfDay(today), endOfDay(today)),
  });

  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const toggleMutation = useToggleTaskStatus();

  const completedCount = blocks.filter(
    (b: EnrichedBlock) => b.task.status === "completed",
  ).length;

  return (
    <div>
      <SectionLabel right={`${completedCount}/${blocks.length}`}>
        Today
      </SectionLabel>
      <p className="text-[0.8125rem] text-muted-foreground mb-3">
        {formatDate(today)}
      </p>

      {blocks.length === 0 ? (
        <p className="text-[0.875rem] text-muted-foreground/50 italic">
          No tasks scheduled for today
        </p>
      ) : (
        <div className="flex flex-col">
          {blocks.map((block: EnrichedBlock) => {
            const isCompleted = block.task.status === "completed";
            const goalColor = block.goal.color ?? "oklch(35% 0 270)";
            const isExpanded = expanded[block.id] ?? false;
            const hasDescription = Boolean(block.task.description);
            const isOverdue =
              !isCompleted && new Date(block.endTime).getTime() < Date.now();

            return (
              <div
                key={block.id}
                onClick={() =>
                  toggleMutation.mutate({
                    taskId: block.task.id,
                    completed: !isCompleted,
                  })
                }
                className={`flex items-start gap-3 py-2.5 px-2 -mx-2 rounded-md cursor-pointer transition-colors duration-150 hover:bg-card ${
                  isCompleted ? "opacity-40" : ""
                }`}
              >
                {/* Time (start → end) */}
                <div className="w-[4.5rem] flex-shrink-0 flex flex-col text-[0.75rem] leading-[1.35] tabular-nums">
                  <span style={{ color: "oklch(55% 0.008 270)" }}>
                    {formatTime(block.startTime)}
                  </span>
                  <span
                    style={{
                      color: isOverdue
                        ? OVERDUE_COLOR
                        : "oklch(40% 0.006 270)",
                    }}
                  >
                    {formatTime(block.endTime)}
                  </span>
                </div>

                {/* Color dot */}
                <div
                  className={`w-[6px] h-[6px] rounded-full flex-shrink-0 mt-[6px] ${
                    isOverdue ? "motion-safe:animate-pulse" : ""
                  }`}
                  style={{
                    backgroundColor: isOverdue ? OVERDUE_COLOR : goalColor,
                  }}
                />

                {/* Checkbox */}
                <motion.div
                  className="w-[1.125rem] h-[1.125rem] rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0 transition-colors duration-150"
                  style={{
                    borderColor: goalColor,
                    backgroundColor: isCompleted ? goalColor : "transparent",
                  }}
                  animate={
                    shouldReduceMotion
                      ? undefined
                      : { scale: isCompleted ? [1, 1.18, 1] : 1 }
                  }
                  transition={{
                    duration: 0.32,
                    ease: easeOutExpo,
                    times: [0, 0.45, 1],
                  }}
                >
                  <AnimatePresence initial={false}>
                    {isCompleted && (
                      <motion.span
                        key="check"
                        initial={
                          shouldReduceMotion
                            ? false
                            : { scale: 0, opacity: 0 }
                        }
                        animate={{ scale: 1, opacity: 1 }}
                        exit={
                          shouldReduceMotion
                            ? undefined
                            : { scale: 0, opacity: 0 }
                        }
                        transition={{ duration: 0.18, ease: easeOutExpo }}
                        className="flex items-center justify-center"
                      >
                        <Check
                          size={10}
                          strokeWidth={3}
                          className="text-background"
                        />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* Title + description */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <span
                      className={`text-[0.9375rem] text-foreground flex-1 ${
                        isCompleted ? "line-through" : ""
                      }`}
                    >
                      {isOverdue && (
                        <TriangleAlert
                          size={13}
                          strokeWidth={2.25}
                          aria-label="Overdue"
                          className="inline-block align-[-0.125em] mr-1.5"
                          style={{ color: OVERDUE_COLOR }}
                        />
                      )}
                      {block.task.title}
                    </span>
                    {hasDescription && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded((prev) => ({
                            ...prev,
                            [block.id]: !isExpanded,
                          }));
                        }}
                        aria-label={
                          isExpanded ? "Hide description" : "Show description"
                        }
                        className="flex-shrink-0 w-6 h-6 -mr-1 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card transition-colors duration-150"
                      >
                        <ChevronDown
                          size={14}
                          className={`transition-transform duration-200 ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                    )}
                  </div>
                  <AnimatePresence initial={false}>
                    {isExpanded && hasDescription && (
                      <motion.p
                        key="description"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: easeOutExpo }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-[0.8125rem] text-muted-foreground mt-1.5 whitespace-pre-wrap leading-relaxed overflow-hidden cursor-text"
                      >
                        {block.task.description}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Goals Section
// ---------------------------------------------------------------------------

function GoalsSection() {
  const { data: goalsData = [] } = useQuery({
    queryKey: ["goals"],
    queryFn: () => api.goals.list("active"),
  });

  if (goalsData.length === 0) return null;

  return (
    <div>
      <SectionLabel>Goals</SectionLabel>

      <div
        className="-mx-5 px-5 flex gap-3 overflow-x-auto pb-1"
        style={{ scrollbarWidth: "none" }}
      >
        {goalsData.map((goal: GoalData, i: number) => {
          const color = goal.color ?? "oklch(50% 0.15 270)";
          return (
            <div
              key={goal.id}
              title={goal.title}
              className="flex-shrink-0 w-[180px] rounded-xl p-4"
              style={{
                border: `1px solid color-mix(in oklch, ${color} 15%, transparent)`,
              }}
            >
              <span className="text-[0.8125rem] text-foreground/85 leading-tight line-clamp-2 min-h-[2.05rem]">
                {goal.title}
              </span>

              <p
                className="text-[1.125rem] font-semibold tabular-nums mt-2.5 leading-none"
                style={{ color }}
              >
                {goal.progress}%
              </p>

              <div className="mt-3 h-[3px] rounded-full bg-muted overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ backgroundColor: color }}
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
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule / Calendar Section
// ---------------------------------------------------------------------------

const DAY_HEADERS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

type ScheduleView = "schedule" | "tasks";

function ScheduleSection() {
  const [view, setView] = useState<ScheduleView>("schedule");

  return (
    <div>
      <ScheduleToggle view={view} onChange={setView} />
      <AnimatePresence mode="wait" initial={false}>
        {view === "schedule" ? (
          <motion.div
            key="schedule"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: easeOutExpo }}
          >
            <CalendarView />
          </motion.div>
        ) : (
          <motion.div
            key="tasks"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: easeOutExpo }}
          >
            <AllTasksView />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule / All Tasks toggle
//
// Two uppercase labels that read as section headers. The sliding underline
// uses a shared layoutId so the bar animates between the active segments
// instead of snapping. No pills, no borders, no chrome — typography
// carries the hierarchy (per the design brief), the bar is one physical
// affordance.
// ---------------------------------------------------------------------------

function ScheduleToggle({
  view,
  onChange,
}: {
  view: ScheduleView;
  onChange: (v: ScheduleView) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div
      role="tablist"
      aria-label="Schedule view"
      className="flex items-center gap-6 mb-4"
    >
      {(
        [
          ["schedule", "Schedule"],
          ["tasks", "All Tasks"],
        ] as const
      ).map(([id, label]) => {
        const active = view === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
            className={`relative font-heading text-[0.6875rem] font-medium uppercase py-1 transition-colors duration-200 ${
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground/75"
            }`}
            style={{ letterSpacing: "0.1em" }}
          >
            {label}
            {active && (
              <motion.span
                layoutId="schedule-toggle-indicator"
                className="absolute left-0 right-0 -bottom-[2px] h-[1.5px] rounded-full bg-foreground"
                transition={
                  shouldReduceMotion
                    ? { duration: 0 }
                    : { duration: 0.32, ease: easeOutExpo }
                }
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Schedule view (calendar + selected-day detail)
// ---------------------------------------------------------------------------

function CalendarView() {
  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }, []);

  const [selectedDate, setSelectedDate] = useState(tomorrow);
  const [viewMonth, setViewMonth] = useState(tomorrow.getMonth());
  const [viewYear, setViewYear] = useState(tomorrow.getFullYear());
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  // Compute the range for the visible calendar grid
  const calendarRange = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    let startOffset = first.getDay() - 1;
    if (startOffset < 0) startOffset = 6;
    const start = new Date(viewYear, viewMonth, 1 - startOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 42);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [viewYear, viewMonth]);

  const { data: blocks = [] } = useQuery({
    queryKey: ["schedule", "blocks", viewYear, viewMonth],
    queryFn: () => api.schedule.blocks(calendarRange.start, calendarRange.end),
  });

  // Group blocks by date key
  const blocksByDate = useMemo(() => {
    const map: Record<string, EnrichedBlock[]> = {};
    for (const block of blocks as EnrichedBlock[]) {
      const key = toDateKey(new Date(block.startTime));
      if (!map[key]) map[key] = [];
      map[key].push(block);
    }
    return map;
  }, [blocks]);

  const calendarDays = useMemo(
    () => getCalendarGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const selectedTasks = blocksByDate[toDateKey(selectedDate)] ?? [];

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
              {selectedTasks.map((block: EnrichedBlock) => {
                const goalColor = block.goal.color ?? "oklch(35% 0 270)";
                const isExpanded = expanded[block.id] ?? false;
                const hasDescription = Boolean(block.task.description);
                const isOverdue =
                  block.task.status !== "completed" &&
                  new Date(block.endTime).getTime() < Date.now();
                return (
                  <div key={block.id} className="flex items-start gap-3 py-1.5">
                    <div className="w-[4.5rem] flex-shrink-0 flex flex-col text-[0.75rem] leading-[1.35] tabular-nums">
                      <span style={{ color: "oklch(55% 0.008 270)" }}>
                        {formatTime(block.startTime)}
                      </span>
                      <span
                        style={{
                          color: isOverdue
                            ? OVERDUE_COLOR
                            : "oklch(40% 0.006 270)",
                        }}
                      >
                        {formatTime(block.endTime)}
                      </span>
                    </div>
                    <div
                      className={`w-[6px] h-[6px] rounded-full flex-shrink-0 mt-[6px] ${
                        isOverdue ? "motion-safe:animate-pulse" : ""
                      }`}
                      style={{
                        backgroundColor: isOverdue ? OVERDUE_COLOR : goalColor,
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <span className="text-[0.875rem] text-foreground/80 flex-1">
                          {isOverdue && (
                            <TriangleAlert
                              size={12}
                              strokeWidth={2.25}
                              aria-label="Overdue"
                              className="inline-block align-[-0.125em] mr-1.5"
                              style={{ color: OVERDUE_COLOR }}
                            />
                          )}
                          {block.task.title}
                        </span>
                        {hasDescription && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((prev) => ({
                                ...prev,
                                [block.id]: !isExpanded,
                              }))
                            }
                            aria-label={
                              isExpanded
                                ? "Hide description"
                                : "Show description"
                            }
                            className="flex-shrink-0 w-6 h-6 -mr-1 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card transition-colors duration-150"
                          >
                            <ChevronDown
                              size={14}
                              className={`transition-transform duration-200 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                            />
                          </button>
                        )}
                      </div>
                      <AnimatePresence initial={false}>
                        {isExpanded && hasDescription && (
                          <motion.p
                            key="description"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2, ease: easeOutExpo }}
                            className="text-[0.8125rem] text-muted-foreground mt-1.5 whitespace-pre-wrap leading-relaxed overflow-hidden"
                          >
                            {block.task.description}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
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
              const dayBlocks = blocksByDate[key] ?? [];
              const isSelected = isSameDay(calDay.date, selectedDate);
              const isTodayCell = isDayToday(calDay.date);

              // Unique goal colors for indicator dots
              const goalColors = [
                ...new Set(
                  dayBlocks
                    .map((b: EnrichedBlock) => b.goal.color)
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
  );
}

// ---------------------------------------------------------------------------
// All Tasks view (infinite scroll)
//
// API already orders unscheduled tasks first, then scheduled ascending by
// earliest block. Client groups them into visual sections: one "Unscheduled"
// group and one group per calendar day. Group headers carry the hierarchy
// (per the brief — typography, not containers). Intersection observer on a
// sentinel triggers the next page.
// ---------------------------------------------------------------------------

interface AllTaskRow {
  id: number;
  goalId: number;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  estimatedMinutes: number | null;
  deadline: string | null;
  createdAt: string;
  earliestBlockStart: string | null;
  goal: { id: number; title: string; color: string | null };
}

interface TaskGroup {
  key: string;
  label: string;
  rows: AllTaskRow[];
}

const TASKS_PAGE_SIZE = 30;

function formatGroupDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const todayKey = toDateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = toDateKey(tomorrow);
  const thisKey = toDateKey(d);

  if (thisKey === todayKey) return "Today";
  if (thisKey === tomorrowKey) return "Tomorrow";

  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function groupTasksByDate(rows: AllTaskRow[]): TaskGroup[] {
  const groups: TaskGroup[] = [];
  const byKey = new Map<string, TaskGroup>();

  for (const row of rows) {
    let key: string;
    let label: string;
    if (!row.earliestBlockStart) {
      key = "unscheduled";
      label = "Unscheduled";
    } else {
      const d = new Date(row.earliestBlockStart);
      key = toDateKey(d);
      label = formatGroupDate(row.earliestBlockStart);
    }

    let group = byKey.get(key);
    if (!group) {
      group = { key, label, rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }

  return groups;
}

function formatBlockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function AllTasksView() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ["tasks", "all"],
    queryFn: ({ pageParam }) =>
      api.tasks.list({ limit: TASKS_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < TASKS_PAGE_SIZE) return undefined;
      return allPages.reduce((sum, p) => sum + p.length, 0);
    },
  });

  const rows = useMemo<AllTaskRow[]>(
    () => (data?.pages ?? []).flat() as AllTaskRow[],
    [data],
  );
  const groups = useMemo(() => groupTasksByDate(rows), [rows]);

  // Infinite-scroll sentinel — fires fetchNextPage when the trailing
  // marker enters the viewport. Guarded by hasNextPage so we don't spam
  // the API once the list is exhausted.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetching) {
          fetchNextPage();
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetching, fetchNextPage]);

  const toggleMutation = useToggleTaskStatus();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-[0.8125rem] text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading tasks
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-8">
        <p className="text-[0.9375rem] text-foreground/80 leading-snug max-w-[32ch]">
          Nothing to work on yet.
        </p>
        <p className="text-[0.8125rem] text-muted-foreground mt-1.5 max-w-[40ch]">
          Ask the assistant to break a goal into tasks, or add them yourself.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.key}>
          <div
            className="font-heading text-[0.6875rem] font-medium uppercase text-muted-foreground mb-2"
            style={{ letterSpacing: "0.1em" }}
          >
            {group.label}
          </div>

          <div className="flex flex-col">
            {group.rows.map((row) => (
              <AllTaskRowItem
                key={row.id}
                row={row}
                onToggle={(completed) =>
                  toggleMutation.mutate({ taskId: row.id, completed })
                }
              />
            ))}
          </div>
        </section>
      ))}

      <div ref={sentinelRef} aria-hidden className="h-1" />

      {isFetchingNextPage && (
        <div className="flex items-center gap-2 py-3 text-[0.75rem] text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Loading more
        </div>
      )}

      {!hasNextPage && rows.length > TASKS_PAGE_SIZE && (
        <p className="text-[0.75rem] text-muted-foreground/50 tabular-nums py-2">
          {rows.length} tasks · end of list
        </p>
      )}
    </div>
  );
}

function AllTaskRowItem({
  row,
  onToggle,
}: {
  row: AllTaskRow;
  onToggle: (completed: boolean) => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const isCompleted = row.status === "completed";
  const goalColor = row.goal.color ?? "oklch(35% 0 270)";
  const [expanded, setExpanded] = useState(false);
  const hasDescription = Boolean(row.description);
  const hasBlock = Boolean(row.earliestBlockStart);

  return (
    <div
      className={`group flex items-start gap-3 py-2.5 px-2 -mx-2 rounded-md transition-colors duration-150 ${
        isCompleted ? "opacity-40" : ""
      }`}
    >
      {/* Time / placeholder column */}
      <div className="w-[4.5rem] flex-shrink-0 flex flex-col text-[0.75rem] leading-[1.35] tabular-nums pt-[1px]">
        {hasBlock ? (
          <span style={{ color: "oklch(55% 0.008 270)" }}>
            {formatBlockTime(row.earliestBlockStart as string)}
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </div>

      {/* Goal color dot */}
      <div
        className="w-[6px] h-[6px] rounded-full flex-shrink-0 mt-[7px]"
        style={{ backgroundColor: goalColor }}
      />

      {/* Checkbox — only affordance that toggles completion */}
      <motion.button
        type="button"
        onClick={() => onToggle(!isCompleted)}
        aria-label={isCompleted ? "Mark as not done" : "Mark as done"}
        aria-pressed={isCompleted}
        className="w-[1.125rem] h-[1.125rem] rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0 transition-colors duration-150 mt-[1px] cursor-pointer"
        style={{
          borderColor: goalColor,
          backgroundColor: isCompleted ? goalColor : "transparent",
        }}
        animate={
          shouldReduceMotion
            ? undefined
            : { scale: isCompleted ? [1, 1.18, 1] : 1 }
        }
        transition={{
          duration: 0.32,
          ease: easeOutExpo,
          times: [0, 0.45, 1],
        }}
      >
        <AnimatePresence initial={false}>
          {isCompleted && (
            <motion.span
              key="check"
              initial={
                shouldReduceMotion ? false : { scale: 0, opacity: 0 }
              }
              animate={{ scale: 1, opacity: 1 }}
              exit={
                shouldReduceMotion ? undefined : { scale: 0, opacity: 0 }
              }
              transition={{ duration: 0.18, ease: easeOutExpo }}
              className="flex items-center justify-center"
            >
              <Check size={10} strokeWidth={3} className="text-background" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Title + goal line */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <span
            className={`text-[0.9375rem] text-foreground flex-1 leading-snug ${
              isCompleted ? "line-through" : ""
            }`}
          >
            {row.title}
          </span>
          {hasDescription && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
              aria-label={expanded ? "Hide description" : "Show description"}
              className="flex-shrink-0 w-6 h-6 -mr-1 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-card transition-colors duration-150"
            >
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${
                  expanded ? "rotate-180" : ""
                }`}
              />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[0.75rem] text-muted-foreground">
            {row.goal.title}
          </span>
          {row.deadline && !hasBlock && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-[0.75rem] text-muted-foreground tabular-nums">
                due{" "}
                {new Date(row.deadline).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </>
          )}
        </div>

        <AnimatePresence initial={false}>
          {expanded && hasDescription && (
            <motion.p
              key="description"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: easeOutExpo }}
              onClick={(e) => e.stopPropagation()}
              className="text-[0.8125rem] text-muted-foreground mt-1.5 whitespace-pre-wrap leading-relaxed overflow-hidden cursor-text"
            >
              {row.description}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Chat Section
// ---------------------------------------------------------------------------

function AIChatSection() {
  return (
    <div>
      <SectionLabel>Assistant</SectionLabel>
      <Coach />
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

  // Connect realtime for live updates
  useRealtime();

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
