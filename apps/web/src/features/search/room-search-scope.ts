/** One Room's search scope: the Room or Thread header opens global search narrowed to it. */
export interface SearchRoomScope {
  id: string;
  name: string;
  /**
   * The chip's own words. A Room header leaves this unset so the chip reads
   * "This Room"; a Thread names itself so the chip says which Thread.
   */
  label?: string;
}

/** What the Room shell hands its routes through the router outlet. */
export interface RoomShellOutletContext {
  /** Opens the global search dialog scoped to one Room. */
  openRoomSearch: (room: SearchRoomScope) => void;
}
