import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";

export interface CreatedMemory {
  store: PostgresStore;
  memory: Memory;
}

export function createMemory(connectionString: string): CreatedMemory {
  const store = new PostgresStore({
    id: "consistent-mastra",
    connectionString,
    schemaName: "mastra",
  });
  const memory = new Memory({
    storage: store,
    options: { lastMessages: 40 },
  });
  return { store, memory };
}
