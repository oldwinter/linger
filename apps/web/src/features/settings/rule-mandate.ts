import type { TeamHubProactiveMandate } from "@/features/teamhub/teamhub-types";

export const mandateChoices: Array<{
  id: TeamHubProactiveMandate;
  title: string;
  detail: string;
}> = [
  {
    id: "none",
    title: "Only remind",
    detail: "Another Me tells you and stops there.",
  },
  {
    id: "create",
    title: "Create a Work Item",
    detail: "Another Me also opens a Work Item for you.",
  },
  {
    id: "create_and_delegate",
    title: "Create and hand off",
    detail: "Another Me opens a Work Item and asks an agent to do it.",
  },
];

export function mandateChoiceTitle(mandate: TeamHubProactiveMandate): string {
  return (
    mandateChoices.find((item) => item.id === mandate)?.title ?? "Only remind"
  );
}
