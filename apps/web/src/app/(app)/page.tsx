"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "@/lib/auth-client";
import { motion, AnimatePresence } from "motion/react";
import {
  LogOut,
  Send,
  Check,
  Loader2,
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
  "Your side project is at 65% -- you're in the home stretch. Focus on the auth bug first, it'll unblock the rest.",
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

function getTomorrowDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function SectionLabel({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <span
          className="text-[12px] text-[#666] uppercase font-medium"
          style={{ letterSpacing: "0.08em" }}
        >
          {children}
        </span>
      </div>
      {right && (
        <span className="text-[12px] text-[#666]">{right}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Now Section
// ---------------------------------------------------------------------------

function NowSection() {
  const nowTask = getAllTasks().find((t) => t.timeframe === "now");
  const [secondsLeft, setSecondsLeft] = useState(15 * 60); // 15 min countdown
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
    <section>
      <SectionLabel>Now</SectionLabel>
      <div className="rounded-lg p-5 border border-white/[0.1] bg-white/[0.03]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setCompleted(!completed)}
            className="w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors"
            style={{
              borderColor: goal.color,
              backgroundColor: completed ? goal.color : "transparent",
            }}
          >
            {completed && <Check size={18} color="#000" strokeWidth={3} />}
          </button>

          <div className="flex-1 min-w-0">
            <p
              className={`text-[16px] font-medium text-white ${
                completed ? "line-through opacity-50" : ""
              }`}
            >
              {nowTask.title}
            </p>
            <p className="text-[13px] text-[#666] mt-0.5">{goal.title}</p>
          </div>

          <div className="text-right flex-shrink-0">
            <p
              className="text-[28px] font-light text-white"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
            </p>
            <p className="text-[11px] text-[#666]">
              {nowTask.startTime} - {nowTask.endTime}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: goal.color }}
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>
    </section>
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
      text: "Hey! You've got a solid day ahead. Your Duolingo lesson is up first \u2014 want me to adjust anything?",
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
      const aiText = aiResponses[Math.floor(Math.random() * aiResponses.length)];
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
    <section>
      <SectionLabel>Assistant</SectionLabel>

      <div className="rounded-lg border border-white/[0.1] bg-white/[0.03] overflow-hidden">
        {/* Messages */}
        <div
          ref={scrollRef}
          className="max-h-[280px] overflow-y-auto p-4 space-y-3"
        >
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] px-3.5 py-2.5 rounded-lg text-[14px] leading-relaxed ${
                  msg.role === "user"
                    ? "bg-white/[0.1] text-[#fafafa]"
                    : "bg-white/[0.05] text-white/80"
                }`}
              >
                {msg.text}
              </div>
            </motion.div>
          ))}

          {/* Typing indicator */}
          <AnimatePresence>
            {isTyping && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex justify-start"
              >
                <div className="bg-white/[0.06] px-4 py-3 rounded-lg flex items-center gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-white/30"
                      animate={{ y: [0, -4, 0] }}
                      transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        delay: i * 0.15,
                      }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Input bar */}
        <div className="border-t border-white/[0.1] p-3 flex items-center gap-2">
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
            className="flex-1 bg-transparent text-[14px] text-white placeholder-white/20 outline-none"
          />
          <button
            onClick={handleSend}
            className="w-8 h-8 rounded-full bg-white/[0.06] flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.1] transition-colors"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </section>
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
    <section>
      <SectionLabel
        right={`${completedCount}/${totalCount} done`}
      >
        Today
      </SectionLabel>

      <p className="text-[13px] text-[#666] mb-3">{formatDate(new Date())}</p>

      <div className="space-y-1">
        {todayTasks.map((task, i) => {
          const goal = getGoalById(task.goalId);
          const isCompleted = taskStates[task.id] ?? false;

          return (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => toggleTask(task.id)}
              className={`flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors hover:bg-white/[0.04] ${
                isCompleted ? "opacity-50" : ""
              }`}
            >
              {/* Time */}
              <span
                className="text-[12px] text-[#666] w-16 flex-shrink-0"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {task.time}
              </span>

              {/* Color bar */}
              <div
                className="w-[3px] h-8 rounded-full flex-shrink-0"
                style={{ backgroundColor: goal?.color ?? "#555" }}
              />

              {/* Checkbox */}
              <div
                className="w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors"
                style={{
                  borderColor: goal?.color ?? "#555",
                  backgroundColor: isCompleted
                    ? goal?.color ?? "#555"
                    : "transparent",
                }}
              >
                {isCompleted && (
                  <Check size={11} color="#000" strokeWidth={3} />
                )}
              </div>

              {/* Title */}
              <span
                className={`text-[14px] text-white/90 ${
                  isCompleted ? "line-through" : ""
                }`}
              >
                {task.title}
              </span>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Goals Section
// ---------------------------------------------------------------------------

function GoalsSection() {
  return (
    <section>
      <SectionLabel>Goals</SectionLabel>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none">
        {goals.map((goal, i) => (
          <motion.div
            key={goal.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="flex-shrink-0 w-[160px] rounded-lg border border-white/[0.1] bg-white/[0.03] p-4"
          >
            {/* Colored dot + title */}
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: goal.color }}
              />
              <span className="text-[13px] text-white/90 font-medium truncate">
                {goal.title}
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden mb-2">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: goal.color }}
                initial={{ width: 0 }}
                animate={{ width: `${goal.progress}%` }}
                transition={{ duration: 0.8, delay: i * 0.1 }}
              />
            </div>

            {/* Percentage */}
            <p
              className="text-[12px] text-[#666]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {goal.progress}%
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tomorrow Section
// ---------------------------------------------------------------------------

function TomorrowSection() {
  const tomorrowTasks = getAllTasks().filter((t) => t.timeframe === "tomorrow");
  const tomorrowDate = getTomorrowDate();

  return (
    <section>
      <SectionLabel>
        Tomorrow
      </SectionLabel>

      <div className="rounded-lg border border-white/[0.1] bg-white/[0.03] p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[13px] text-white/60">{formatDate(tomorrowDate)}</p>
          <span className="text-[12px] text-[#666]">
            {tomorrowTasks.length} tasks
          </span>
        </div>

        <div className="space-y-2">
          {tomorrowTasks.map((task, i) => {
            const goal = getGoalById(task.goalId);
            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center gap-3"
              >
                <div
                  className="w-[3px] h-6 rounded-full flex-shrink-0"
                  style={{ backgroundColor: goal?.color ?? "#555" }}
                />
                <span className="text-[13px] text-white/50">{task.title}</span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
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
        onClick={() => setOpen(!open)}
        className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium text-[#fafafa] bg-white/[0.1] transition-colors hover:bg-white/[0.15]"
      >
        {initial}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-12 w-56 rounded-xl border border-white/[0.08] bg-[#111] p-3 shadow-xl z-50"
          >
            <p className="text-[13px] text-white/90 font-medium truncate">
              {userName}
            </p>
            <p className="text-[12px] text-[#666] truncate mb-3">
              {userEmail}
            </p>

            <button
              onClick={handleSignOut}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-[#fafafa] hover:bg-white/[0.05] transition-colors"
            >
              <LogOut size={14} />
              Sign Out
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

  // Loading state
  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <Loader2 className="w-6 h-6 text-[#666] animate-spin" />
      </div>
    );
  }

  // Redirecting (no session)
  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <Loader2 className="w-6 h-6 text-[#666] animate-spin" />
      </div>
    );
  }

  const userName = session.user.name || session.user.email || "User";
  const userEmail = session.user.email || "";

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/[0.1] bg-black/80 backdrop-blur-xl">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-5 h-14">
          <span className="text-[15px] font-semibold tracking-tight text-[#fafafa]">
            Consistent
          </span>
          <ProfileDropdown userName={userName} userEmail={userEmail} />
        </div>
      </header>

      {/* Dashboard Content */}
      <main className="max-w-2xl mx-auto px-5 py-6 space-y-8 pb-20">
        <NowSection />
        <AIChatSection />
        <TodaySection />
        <GoalsSection />
        <TomorrowSection />
      </main>
    </div>
  );
}
