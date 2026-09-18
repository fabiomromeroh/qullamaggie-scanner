package main

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func exeDir() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		// Fall back to non-resolved path on EvalSymlinks failure
		exe, _ = os.Executable()
	}
	return filepath.Dir(exe), nil
}

func waitReady(url string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 800 * time.Millisecond}
	var last error
	for time.Now().Before(deadline) {
		resp, err := client.Get(url)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 500 {
				return nil
			}
			last = fmt.Errorf("status %d", resp.StatusCode)
		} else {
			last = err
		}
		time.Sleep(200 * time.Millisecond)
	}
	if last == nil {
		last = fmt.Errorf("timeout")
	}
	return fmt.Errorf("server not ready at %s: %v", url, last)
}

func openBrowser(url string) {
	cmd := exec.Command("cmd", "/c", "start", "", url)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Start()
}

func showError(msg string) {
	// Best-effort popup when built as windowsgui (no console)
	ps := fmt.Sprintf(
		"Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show([string]%s, 'Qullamaggie Dashboard') | Out-Null",
		psQuote(msg),
	)
	c := exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = c.Run()
}

func psQuote(s string) string {
	// PowerShell single-quoted string: double any single quotes
	out := "'"
	for _, r := range s {
		if r == '\'' {
			out += "''"
		} else {
			out += string(r)
		}
	}
	out += "'"
	return out
}

func main() {
	root, err := exeDir()
	if err != nil {
		fatal(root, "resolve exe dir: %v", err)
	}

	node := filepath.Join(root, "runtime", "node.exe")
	server := filepath.Join(root, "app", "server.mjs")
	if _, err := os.Stat(node); err != nil {
		fatal(root, "missing runtime\\node.exe — re-extract the package")
	}
	if _, err := os.Stat(server); err != nil {
		fatal(root, "missing app\\server.mjs — re-extract the package")
	}

	cmd := exec.Command(node, server)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "NODE_NO_WARNINGS=1")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		fatal(root, "stdout pipe: %v", err)
	}
	// Keep stderr attached quietly (no console when windowsgui)
	cmd.Stderr = nil

	if err := cmd.Start(); err != nil {
		fatal(root, "start node: %v", err)
	}

	port := 5173
	readyCh := make(chan int, 1)
	go func() {
		buf := make([]byte, 8192)
		n, _ := stdout.Read(buf)
		line := string(buf[:n])
		p := extractPort(line)
		if p > 0 {
			readyCh <- p
		} else {
			readyCh <- 5173
		}
		for {
			if _, err := stdout.Read(buf); err != nil {
				return
			}
		}
	}()

	select {
	case port = <-readyCh:
	case <-time.After(10 * time.Second):
		port = 5173
	}

	urls := []string{
		fmt.Sprintf("http://127.0.0.1:%d/", port),
		"http://127.0.0.1:5173/",
		"http://127.0.0.1:17865/",
	}
	var url string
	for _, u := range urls {
		if err := waitReady(u, 20*time.Second); err == nil {
			url = u
			break
		}
	}
	if url == "" {
		_ = cmd.Process.Kill()
		fatal(root, "dashboard server did not become ready (tried ports 5173 and 17865). Check .env and firewall.")
	}

	openBrowser(url)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	select {
	case <-sigCh:
		killTree(cmd)
		<-done
	case err := <-done:
		if err != nil {
			fatal(root, "server exited: %v", err)
		}
	}
}

func killTree(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

func extractPort(s string) int {
	key := `"port"`
	i := indexOf(s, key)
	if i < 0 {
		return 0
	}
	rest := s[i+len(key):]
	j := 0
	for j < len(rest) && (rest[j] == ' ' || rest[j] == ':' || rest[j] == '\t') {
		j++
	}
	n := 0
	for j < len(rest) && rest[j] >= '0' && rest[j] <= '9' {
		n = n*10 + int(rest[j]-'0')
		j++
	}
	return n
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func fatal(root, format string, args ...any) {
	msg := fmt.Sprintf(format, args...)
	if root != "" {
		_ = os.WriteFile(filepath.Join(root, "dashboard-error.log"), []byte(msg+"\n"), 0644)
	}
	showError(msg)
	os.Exit(1)
}
