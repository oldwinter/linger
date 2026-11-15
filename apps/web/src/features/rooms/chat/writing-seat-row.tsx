import { ActorAvatar } from "../members/actor-avatar";

/** Unsent words sitting in the writer's place at the end of the room. */
export function WritingSeatRow({
  actorId,
  name,
  startsGroup = true,
  text,
}: {
  actorId?: string;
  name: string;
  startsGroup?: boolean;
  text: string;
}) {
  return (
    <article
      aria-label="Still writing"
      className="room-message-card message-row opacity-80"
      data-author-kind="human"
      data-current-actor="true"
      data-group-start={startsGroup}
      data-writing-seat="true"
    >
      <div className="room-message-avatar">
        {startsGroup && actorId ? (
          <ActorAvatar actorId={actorId} kind="human" name={name} size="sm" />
        ) : null}
      </div>
      <div className="room-message-content min-w-0">
        <div className="room-message-bubble text-sm leading-5 text-app-body">
          <p className="whitespace-pre-wrap break-words">{text}</p>
        </div>
      </div>
    </article>
  );
}
