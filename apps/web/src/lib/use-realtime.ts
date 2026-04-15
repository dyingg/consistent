"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "./socket";

export function useRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();

    if (!socket.connected) {
      socket.connect();
    }

    const handleGoalUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    };

    const handleTaskUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    };

    const handleScheduleUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
    };

    socket.on("goal:updated", handleGoalUpdated);
    socket.on("task:updated", handleTaskUpdated);
    socket.on("schedule:updated", handleScheduleUpdated);

    return () => {
      socket.off("goal:updated", handleGoalUpdated);
      socket.off("task:updated", handleTaskUpdated);
      socket.off("schedule:updated", handleScheduleUpdated);
    };
  }, [queryClient]);
}
