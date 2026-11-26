import { defineMessages } from "@/i18n/messages";

/** Settings › Profile and Settings › Security, with the dialogs they open. */
export const accountSettingsMessages = defineMessages("accountSettings", {
  // Profile page
  loadingAccountProfile: "Loading Account profile",
  loadingAccountProfileStatus: "Loading Account profile...",

  // Profile card: photo, cover and display name
  profileAppearance: "Profile appearance",
  changeCover: "Change cover",
  uploadProfilePhoto: "Upload profile photo",
  profileDisplayName: "Profile display name",
  editDisplayName: "Edit display name",
  profilePhotoFile: "Profile photo file",
  profileCoverFile: "Profile cover file",
  savingProfile: "Saving profile…",
  imageUploadFailed: "Could not upload image. Try again.",
  imageTypeUnsupported: "Choose a JPG, PNG, or WebP image.",
  imageTooLarge: "Choose an image smaller than 5 MB.",
  imageUnreadable: "Your browser could not read this image.",
  imageTooDetailed: "This image is too detailed. Choose a smaller image.",

  // Bio and organization
  bio: "Bio",
  bioPlaceholder: "A short description of how you work.",
  organization: "Organization",
  organizationPlaceholder: "Your company or organization",
  handEditedHint: "Fields you edit won't be overwritten.",
  accountSaved: "Account saved",
  saving: "Saving...",

  // Insights
  insights: "Insights",
  loadingInsights: "Loading insights...",
  noInsights: "No insights yet.",
  insightsAppearHint: "Insights appear as Another Me learns how you work.",
  editsAlwaysKeptHint:
    "Your edits are always kept. Automatic profile updates only fill in fields you haven't edited.",
  removeInsightQuestion: "Remove?",
  confirmRemove: "Confirm",
  confirmRemoveInsight: "Confirm removing {dimension} insight",
  deleteInsight: "Delete insight",
  deleteNamedInsight: "Delete {dimension} insight",

  // Add profile sources dialog
  addProfileSources: "Add profile sources",
  addToProfile: "Add to your profile",
  profileSources: "Profile sources",
  accounts: "Accounts",
  files: "Files",
  anotherAI: "Another AI",
  privacyAccounts: "Only what you choose is used.",
  privacyAI: "Only updates your Profile.",
  privacyFiles: "Files stay in your library.",
  pasteSummaryFirst: "Paste an AI summary first.",
  addFileFirst: "Add a file first.",
  copyUnavailable: "Copy is unavailable.",
  fileUploadFailed: "File upload failed.",
  uploadedFileHasNoVersion: "Uploaded profile Document has no current Version.",
  continueInBrowser: "Continue in browser",
  add: "Add",
  choose: "Choose",

  // Accounts pane
  loadingAccounts: "Loading accounts…",
  profileAppsUnavailable: "Profile apps are unavailable right now.",
  waitingForAuthorization: "Waiting for authorization",
  backToAccounts: "Back to accounts",
  chooseProviderContent: "Choose {provider} content",
  connectedAccount: "Connected account",
  chooseApp: "Choose {app}",
  addApp: "Add {app}",
  chooseAppFromAccount: "Choose {app} from {account}",
  addAppFromAccount: "Add {app} from {account}",
  connectedAs: "Connected: {account}",
  // Stands in for {account} when a connection has no name to show.
  unnamedAccount: "account",
  connectedAccountsCount: {
    one: "{count} connected account",
    other: "{count} connected accounts",
  },
  unavailable: "Unavailable",
  connectionNeedsAttention: "Needs attention",
  authorizationInProgress: "Authorization in progress",
  notConnected: "Not connected",
  continueAppAuthorization: "Continue {app} authorization",
  continue: "Continue",
  openApps: "Open Apps",
  needsAttentionAccount: "Needs attention in Apps: {account}",

  // Content picker of one connected account
  pickerDiscord: "Discord channels",
  pickerGitHub: "GitHub repositories",
  pickerGoogleCalendar: "Google calendars",
  pickerNotion: "Notion pages and databases",
  pickerSlack: "Slack channels",
  selectedOfMaximum: "{selected}/{maximum} selected",
  publicProfileIncluded: "Your public profile is always included.",
  notionShareFirst:
    "Share pages or databases with the Notion integration first.",
  private: "Private",
  loadMoreChannels: "Load more channels",
  loadMoreRepositories: "Load more repositories",
  loadMoreCalendars: "Load more calendars",
  loadMorePages: "Load more pages",
  addGitHubProfile: "Add GitHub profile",
  addGitHubProfileAndRepositories: {
    one: "Add GitHub profile + {count} repository",
    other: "Add GitHub profile + {count} repositories",
  },
  addCalendars: {
    one: "Add {count} calendar",
    other: "Add {count} calendars",
  },
  addNotionItems: {
    one: "Add {count} Notion item",
    other: "Add {count} Notion items",
  },
  addSlackChannels: {
    one: "Add {count} Slack channel",
    other: "Add {count} Slack channels",
  },
  addDiscordChannels: {
    one: "Add {count} Discord channel",
    other: "Add {count} Discord channels",
  },

  // Files pane
  filesHint: "PDF, Word, or text. Up to five files.",
  profileFiles: "Profile files",
  chooseFiles: "Choose files",
  removeFile: "Remove {name}",

  // Another AI pane
  promptToUse: "Prompt to use",
  copyPrompt: "Copy prompt",
  promptCopied: "Prompt copied",
  externalAIPrompt:
    "Based on our previous conversations and what you know about me, write a concise personal profile and list the key memories that would help another AI understand me. Include my current roles, projects, goals, working style, preferences, tools, and important constraints. Clearly separate facts I explicitly shared from your inferences, flag anything uncertain or possibly outdated, and exclude secrets or other people's sensitive information.",
  aiSummary: "AI summary",
  aiSummaryPlaceholder: "Paste the summary from ChatGPT, Claude, or another AI",

  // Disconnect account dialog
  disconnectTitle: "Disconnect account?",
  disconnectDescription:
    "{account}. Agent access and source cleanup stay on Apps.",
  disconnect: "Disconnect",

  // Security page
  password: "Password",
  changePassword: "Change password",
  passwordChanged: "Password changed",
  currentPassword: "Current password",
  newPassword: "New password",
  confirmNewPassword: "Confirm new password",
  passwordsDoNotMatch: "Passwords do not match.",

  // API keys
  apiKeys: "API keys",
  apiKeysDescription:
    "Shared by everyone on this server. Stored encrypted and never shown again.",
  providerKey: "{provider} key",
  providerKeySaved: "{provider} key saved",
  keySetByServer: "Set by your server",
  keyActive: "Active",
  keyNotSet: "Not set",
  replaceProviderKey: "Replace {provider} key",
  addProviderKey: "Add {provider} key",
  replaceKey: "Replace key",
  addKey: "Add key",
  voiceKeyFromEnvironment: "{detail} Set with {variable} on the server.",
  voiceKeyCannotSave: "{detail} Set {variable} on the server.",
  composioDetail: "Connects Gmail, GitHub, Slack, Notion and other apps.",
  composioDetailFromEnvironment:
    "Connects Gmail, GitHub, Slack, Notion and other apps. Set with COMPOSIO_API_KEY on the server.",
  composioDetailCannotSave: "Not set on this server.",
  byokKeysTitle: "Model provider API keys (BYOK)",
  byokKeysDescription:
    "Configure OpenAI- or Anthropic-compatible provider keys per computer in Settings › Models. Keys stay private on each computer.",
  openModelsSettings: "Open Models settings",

  // Browser preferences
  thisBrowser: "This browser",
  clear: "Clear",
  thisBrowserHint:
    "These preferences stay on this computer. Clearing them does not sign you out, change your Account, or change anything on TeamHub.",
  clearPreferencesConfirm: "Clear every preference listed here?",
  clearPreferences: "Clear preferences",
  preferencesCleared: "Preferences cleared",
  preferencesClearFailed: "Preferences could not be cleared",
  prefLastOpenedRoom: "Last opened room",
  prefComposerDrafts: "Composer drafts",
  prefRoomMentionPreferences: "Room mention snoozes and mutes",
  prefSnoozedRooms: "Snoozed Rooms",
  prefRoomListFilter: "Room list filter",
  prefDesktopNotificationPause: "Desktop notification pause",
  prefRecentSearches: "Recent searches",
  prefRecentDocuments: "Recently opened documents",
  prefMeetingResume: "Meeting listening positions",
  prefMeetingPlaybackSpeed: "Meeting playback speed",
  prefRecentWikiPages: "Recently opened Wiki pages",

  // Desktop notifications
  desktopNotifications: "Desktop notifications",
  enable: "Enable",
  notificationsDenied:
    "Notifications are blocked. Allow notifications for this site in your browser or system settings, then reload this page.",
  notificationsDefault:
    "Notifications are off. Enable them to be told about unread mentions while this window is in the background.",
  notificationsGranted: "Notifications are on.",
  notificationsUnsupported:
    "This browser cannot show desktop notifications, so mentions stay in the Room list.",
  pausedUntil: "Paused until",
  resumeNow: "Resume now",
  pauseNotifications: "Pause notifications:",
  pauseForHour: "Pause for 1 hour",
  pauseUntilMorning: "Pause until tomorrow morning",
  desktopNotificationsFooter:
    "Unread mentions in Rooms you are not looking at appear while this window is in the background, unless that Room’s mentions are snoozed. A pause silences every desktop notification, whatever raises it. The desktop app also shows the unread mention count on its icon.",
});
