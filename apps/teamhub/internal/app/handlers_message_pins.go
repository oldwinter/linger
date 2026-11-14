package app

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (a *App) putMessagePin(c *gin.Context) {
	err := a.collaboration.PutMessagePin(c.Request.Context(), currentPrincipal(c).Session.AccountID,
		c.Param("roomId"), c.Param("messageId"))
	if a.notFoundOrError(c, "pin Message", err) {
		return
	}
	c.Status(http.StatusNoContent)
}

func (a *App) deleteMessagePin(c *gin.Context) {
	err := a.collaboration.DeleteMessagePin(c.Request.Context(), currentPrincipal(c).Session.AccountID,
		c.Param("roomId"), c.Param("messageId"))
	if a.notFoundOrError(c, "unpin Message", err) {
		return
	}
	c.Status(http.StatusNoContent)
}

func (a *App) listMessagePins(c *gin.Context) {
	pins, err := a.collaboration.ListMessagePins(c.Request.Context(), currentPrincipal(c).Session.AccountID,
		c.Param("roomId"))
	if a.notFoundOrError(c, "list Message Pins", err) {
		return
	}
	c.JSON(http.StatusOK, pins)
}
