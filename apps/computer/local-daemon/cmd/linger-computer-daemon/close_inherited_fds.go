package main

import (
	localprocess "github.com/simplexai-labs/linger/apps/computer/local-daemon/internal/process"
)

// closeInheritedFDs closes non-stdio file descriptors (Unix) or inherited
// File/Section handles (Windows) that survived parent process spawn so the
// daemon and its child runtimes never retain parent sockets or app files.
func closeInheritedFDs() {
	localprocess.CloseInheritedHandles()
}
