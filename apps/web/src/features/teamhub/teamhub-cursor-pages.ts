import { translate } from "@/i18n/language";

import { TeamHubError } from "./teamhub-client";
import { teamHubClientErrorMessages as m } from "./teamhub-client-errors.messages";
import type { TeamHubPageInput } from "./teamhub-types";

const defaultPageSize = 200;
const maximumPageCount = 100;
const maximumItemCount = defaultPageSize * maximumPageCount;

interface CursorPage {
  items: unknown[];
  page: { has_more: boolean; next_cursor?: string };
}

export async function collectTeamHubCursorPages<Page extends CursorPage>(
  loadPage: (page: TeamHubPageInput) => Promise<Page>,
  options: { pageSize?: number } = {},
): Promise<Page> {
  const pageSize = options.pageSize ?? defaultPageSize;
  if (
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > defaultPageSize
  ) {
    throw new TypeError(
      "TeamHub cursor page size must be an integer in 1..200",
    );
  }
  const items: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let loadedPageCount = 0;

  while (loadedPageCount < maximumPageCount) {
    const current = await loadPage({
      ...(cursor ? { cursor } : {}),
      limit: pageSize,
    });
    loadedPageCount += 1;

    if (items.length + current.items.length > maximumItemCount) {
      throwPaginationLimitExceeded();
    }
    items.push(...current.items);

    if (!current.page.has_more) {
      return {
        ...current,
        items: items,
        page: { has_more: false },
      };
    }

    const nextCursor = current.page.next_cursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new TeamHubError({
        code: "INVALID_PAGINATION",
        message: translate(m.invalidCursor),
        status: 502,
      });
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throwPaginationLimitExceeded();
}

function throwPaginationLimitExceeded(): never {
  throw new TeamHubError({
    code: "PAGINATION_LIMIT_EXCEEDED",
    message: translate(m.directoryTooLong),
    status: 502,
  });
}
