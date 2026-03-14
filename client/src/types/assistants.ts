import type { AssistantType } from "@shared/schema";

export type AssistantSelection = {
  id: string;
  type: AssistantType;
  name?: string | null;
};
