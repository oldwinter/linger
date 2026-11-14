export function askMeetingPath(tenantId: string, meetingId: string) {
  return `/t/${encodeURIComponent(tenantId)}/library/meetings/ask?entry=${encodeURIComponent(meetingId)}`;
}

export function meetingQuestionsKey(captureId: string) {
  return ["teamhub", "meeting-questions", captureId] as const;
}
