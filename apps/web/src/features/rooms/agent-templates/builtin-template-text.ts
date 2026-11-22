import { teamHubCatalogText } from "@/features/teamhub/teamhub-catalog-text";
import type { TeamHubAgentTemplate } from "@/features/teamhub/teamhub-types";
import type { Translate } from "@/i18n/language";
import type { Message } from "@/i18n/messages";

import { builtinTemplateMessages as m } from "./builtin-templates.messages";

const builtins: Readonly<
  Record<string, { name: Message<string>; description: Message<string> }>
> = {
  "research-analyst": {
    name: m.researchAnalystName,
    description: m.researchAnalystDescription,
  },
  "code-reviewer": {
    name: m.codeReviewerName,
    description: m.codeReviewerDescription,
  },
};

type Template = Pick<
  TeamHubAgentTemplate,
  "description" | "name" | "origin" | "template_id"
>;

// A published template is a Human's own words and stays as they wrote it.
function builtin(template: Template) {
  return template.origin === "builtin" &&
    Object.hasOwn(builtins, template.template_id)
    ? builtins[template.template_id]
    : undefined;
}

/** A template's name, worded for TeamHub's built-in templates. */
export function templateName(template: Template, t: Translate): string {
  return teamHubCatalogText(template.name, builtin(template)?.name, t);
}

/** A template's description, worded for TeamHub's built-in templates. */
export function templateDescription(template: Template, t: Translate): string {
  return teamHubCatalogText(
    template.description,
    builtin(template)?.description,
    t,
  );
}
