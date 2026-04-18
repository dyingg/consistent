import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { UsersRepository } from "../../users/users.repository";

const RESOURCE_ID_KEY = "mastra__resourceId";
export const USER_TIMEZONE_KEY = "userTimezone";
export const CLIENT_TIME_KEY = "clientTime";

function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function pickFromContext(context: any, key: string): string | undefined {
  const raw = context?.requestContext?.get?.(key);
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

async function resolveTimezone(
  context: any,
  usersRepository: UsersRepository,
  userId: string,
): Promise<{ timezone: string; fromBrowser: boolean }> {
  const fromBrowser = pickFromContext(context, USER_TIMEZONE_KEY);
  if (fromBrowser && isValidTimezone(fromBrowser)) {
    return { timezone: fromBrowser, fromBrowser: true };
  }
  const user = await usersRepository.findById(userId);
  const stored = user?.timezone;
  if (stored && isValidTimezone(stored)) {
    return { timezone: stored, fromBrowser: false };
  }
  return { timezone: "UTC", fromBrowser: false };
}

function computeOffset(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const match = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return "+00:00";
  const [, sign, hh, mm = "00"] = match;
  return `${sign}${hh.padStart(2, "0")}:${mm}`;
}

function formatParts(now: Date, timezone: string) {
  const iso = now.toISOString();
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  }).format(now);
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
  }).format(now);
  const offset = computeOffset(now, timezone);
  return { iso, local, weekday, localDate, offset };
}

export function createTimeTools(usersRepository: UsersRepository) {
  const getCurrentTime = createTool({
    id: "get-current-time",
    description:
      "Get the current time and date in the user's local timezone. Call this whenever the user uses relative times like 'in an hour', 'tomorrow', 'this afternoon', or asks what day it is. Returns ISO timestamp, localized string, weekday name, and timezone.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      currentTime: z.string().describe("ISO 8601 timestamp (UTC)"),
      timezone: z.string().describe("IANA timezone identifier"),
      offset: z
        .string()
        .describe(
          "Current UTC offset for the user's timezone in ±HH:MM form (e.g. -07:00, +05:30, +00:00). Append this to wall-clock ISO strings you send to other tools.",
        ),
      localTime: z.string().describe("Human-readable local time"),
      weekday: z.string().describe("Day of the week in the user's timezone"),
      localDate: z
        .string()
        .describe("YYYY-MM-DD date in the user's timezone"),
    }),
    execute: async (_input, context) => {
      const userId = context?.requestContext?.get?.(RESOURCE_ID_KEY) as
        | string
        | undefined;
      if (!userId) throw new Error("unauthorized");

      const { timezone, fromBrowser } = await resolveTimezone(
        context,
        usersRepository,
        userId,
      );

      if (fromBrowser) {
        void syncTimezoneIfChanged(usersRepository, userId, timezone);
      }

      const clientTimeRaw = pickFromContext(context, CLIENT_TIME_KEY);
      const clientTime = clientTimeRaw ? new Date(clientTimeRaw) : null;
      const now =
        clientTime && !Number.isNaN(clientTime.getTime())
          ? clientTime
          : new Date();

      const parts = formatParts(now, timezone);
      return {
        currentTime: parts.iso,
        timezone,
        offset: parts.offset,
        localTime: parts.local,
        weekday: parts.weekday,
        localDate: parts.localDate,
      };
    },
  });

  return {
    "get-current-time": getCurrentTime,
  };
}

async function syncTimezoneIfChanged(
  usersRepository: UsersRepository,
  userId: string,
  browserTimezone: string,
): Promise<void> {
  try {
    const user = await usersRepository.findById(userId);
    if (!user) return;
    if (user.timezone === browserTimezone) return;
    await usersRepository.updateTimezone(userId, browserTimezone);
  } catch {
    // best-effort; do not block the tool response
  }
}
