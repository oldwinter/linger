/** One Room's search scope: the Room header opens global search narrowed to it. */
export interface SearchRoomScope {
  id: string;
  name: string;
}

/** What the Room shell hands its routes through the router outlet. */
export interface RoomShellOutletContext {
  /** Opens the global search dialog scoped to one Room. */
  openRoomSearch: (room: SearchRoomScope) => void;
}
