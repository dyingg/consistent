const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

export const api = {
  goals: {
    list: (status?: string) =>
      apiFetch<any[]>(
        `/v1/goals${status ? `?status=${encodeURIComponent(status)}` : ""}`,
      ),
  },
  schedule: {
    blocks: (start: string, end: string) =>
      apiFetch<any[]>(
        `/v1/schedule/blocks?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
      ),
    now: () => apiFetch<any | null>("/v1/schedule/now"),
  },
  tasks: {
    update: (id: number, data: Record<string, unknown>) =>
      apiFetch<any>(`/v1/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
  },
};
