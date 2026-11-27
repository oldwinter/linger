//go:build !windows

package main

// platformExecEntry handles Windows-only isolated child execution.
func platformExecEntry([]string) (int, bool, error) { return 0, false, nil }

// platformEntry handles the Windows-only helper subcommands; elsewhere every
// argument list is a Daemon launch.
func platformEntry([]string) (bool, error) { return false, nil }
