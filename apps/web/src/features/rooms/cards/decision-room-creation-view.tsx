import { UserGroupIcon } from "@hugeicons/core-free-icons";
import { Link } from "react-router";

import { Icon } from "@/components/ui/icon";
import { RichMessage, useT } from "@/i18n/use-translation";

import { cardsMessages } from "./cards.messages";
import { CreationMessagePreview } from "./creation-message-preview";
import type { DecisionMessageCard } from "./decision-card";

type RoomCreationView = NonNullable<DecisionMessageCard["room_creation"]>;

const emptyActorDisplayNames: Readonly<Record<string, string>> = {};

/**
 * The Room an Agent asked to create, as TeamHub froze it: its members and
 * first message.
 */
export function RoomCreationDecisionView({
  actorDisplayNames = emptyActorDisplayNames,
  view,
}: {
  actorDisplayNames?: Readonly<Record<string, string>>;
  view: RoomCreationView;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5 text-xs text-app-muted">
      <p className="[overflow-wrap:anywhere]">
        <RichMessage
          message={cardsMessages.membersLine}
          tags={{
            label: (text) => (
              <span className="font-medium text-app-body">{text}</span>
            ),
          }}
          values={{
            names: view.member_ids
              .map((actorId) => actorDisplayNames[actorId] ?? actorId)
              .join(t(cardsMessages.listSeparator)),
          }}
        />
      </p>
      <CreationMessagePreview
        actorDisplayNames={actorDisplayNames}
        segments={view.initial_message_segments}
      />
    </div>
  );
}

/** The link to a Room TeamHub created from an approved request. */
export function OpenCreatedRoomLink({
  roomId,
  tenantId,
}: {
  roomId: string;
  tenantId: string;
}) {
  const t = useT();
  return (
    <Link
      className="typed-card-link"
      to={`/t/${encodeURIComponent(tenantId)}/rooms/${encodeURIComponent(
        roomId,
      )}/chat`}
    >
      <Icon icon={UserGroupIcon} size={14} />
      {t(cardsMessages.openRoom)}
    </Link>
  );
}
