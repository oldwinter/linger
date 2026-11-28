package app

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/agentruntimestate"
	"github.com/simplexai-labs/linger/apps/teamhub/internal/taskexecution"
	httpapi "github.com/simplexai-labs/linger/contracts-go/teamhubpublic"
)

func (a *App) listTaskRuntimePresentationRuns(c *gin.Context) {
	params := contractParams[httpapi.ListTaskRuntimePresentationRunsParams](c)
	limit := runtimePresentationDefaultLimit
	if params.Limit != nil {
		limit = *params.Limit
	}
	page, err := a.taskExecutions.ListRuntimePresentationRunsForHuman(
		c.Request.Context(),
		currentPrincipal(c).Session.AccountID,
		c.Param("taskId"),
		params.Cursor,
		limit,
	)
	switch {
	case errors.Is(err, taskexecution.ErrInvalid):
		a.writeError(c, http.StatusBadRequest, "INVALID_REQUEST", "Task activity pagination is invalid")
		return
	case errors.Is(err, taskexecution.ErrNotFound):
		a.writeError(c, http.StatusNotFound, "NOT_FOUND", "resource was not found")
		return
	case err != nil:
		a.internalError(c, "read Task activities", err)
		return
	}
	c.JSON(http.StatusOK, httpapi.TaskRuntimePresentationRunPage{
		WorkRoomId:   page.WorkRoomID,
		ActiveItems:  taskPresentationRuns(page.ActiveItems),
		HistoryItems: taskPresentationRuns(page.HistoryItems),
		NextCursor:   page.NextCursor,
	})
}

func taskPresentationRuns(rows []agentruntimestate.RoomRunStatusFields) []httpapi.RoomRunStatus {
	items := make([]httpapi.RoomRunStatus, 0, len(rows))
	for _, row := range rows {
		items = append(items, agentruntimestate.RoomRunStatus(row))
	}
	return items
}
