import { useEffect, useRef } from "react";

/**
 * Closes a profile only after that person was in the room and then left.
 * A profile opened for someone who is not a member stays as it was.
 */
export function useCloseDepartedProfile(
  profileId: string | null,
  memberIds: readonly string[],
  onClose: () => void,
) {
  const seen = useRef<string | null>(null);
  const memberKey = [...memberIds].sort().join("\0");
  useEffect(() => {
    if (!profileId) {
      seen.current = null;
      return;
    }
    if (memberKey.split("\0").includes(profileId)) {
      seen.current = profileId;
      return;
    }
    if (seen.current !== profileId) return;
    seen.current = null;
    onClose();
  }, [memberKey, onClose, profileId]);
}
