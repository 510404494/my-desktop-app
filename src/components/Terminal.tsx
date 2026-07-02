import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { ServerConfig } from '../types'

interface TerminalProps {
  server: ServerConfig
  onConnect?: () => void
  onDisconnect?: () => void
  onPathChange?: (path: string) => void
  defaultRemotePath?: string
}

interface UploadFile {
  name: string
  path: string
  size: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  progress: number
}

function Terminal({ server, onConnect, onDisconnect, onPathChange, defaultRemotePath }: TerminalProps) {
  const [output, setOutput] = useState('')
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentDir, setCurrentDir] = useState('~')
  const [completions, setCompletions] = useState<string[]>([])
  const [completionIndex, setCompletionIndex] = useState(-1)
  const [showCompletions, setShowCompletions] = useState(false)
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([])
  const [showUploadPanel, setShowUploadPanel] = useState(false)
  const terminalBodyRef = useRef<HTMLDivElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [output, scrollToBottom])

  async function checkConnection() {
    try {
      const connected = await invoke<boolean>('terminal_is_connected')
      if (connected) {
        setIsConnected(true)
        onConnect?.()
      }
    } catch {
      setIsConnected(false)
    }
  }

  useEffect(() => {
    checkConnection()
  }, [])

  async function connect() {
    if (isConnected || isConnecting) return
    
    setIsConnecting(true)
    setError(null)
    
    try {
      const result = await invoke<string>('terminal_connect', {
        host: server.host,
        port: server.port,
        username: server.username,
        password: server.password,
      })
      setOutput(result)
      setIsConnected(true)
      setCurrentDir('~')
      onConnect?.()
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (errMsg.includes('已有连接存在')) {
        setIsConnected(true)
        onConnect?.()
      } else {
        setError(`连接失败: ${err}`)
      }
    } finally {
      setIsConnecting(false)
    }
  }

  async function sendCommand(cmd: string) {
    if (!isConnected || !cmd.trim()) return

    const trimmedCmd = cmd.trim()
    setInput('')
    setHistoryIndex(-1)
    
    setOutput(prev => prev + `\n${server.username}@${server.host}:${currentDir}$ ${trimmedCmd}`)
    
    if (trimmedCmd) {
      setHistory(prev => [...prev, trimmedCmd])
    }

    try {
      const result = await invoke<string>('terminal_send', { command: trimmedCmd })
      setOutput(prev => prev + '\n' + result)
      
      if (trimmedCmd.startsWith('cd ')) {
        const newDir = trimmedCmd.substring(3).trim() || '~'
        let resolvedDir: string
        if (newDir.startsWith('/')) {
          resolvedDir = newDir
        } else if (newDir === '..') {
          const parts = currentDir.split('/').filter(Boolean)
          parts.pop()
          resolvedDir = '/' + parts.join('/') || '/'
        } else if (newDir !== '~') {
          resolvedDir = currentDir.endsWith('/') ? currentDir + newDir : currentDir + '/' + newDir
        } else {
          resolvedDir = '~'
        }
        setCurrentDir(resolvedDir)
        onPathChange?.(resolvedDir)
      }
    } catch (err) {
      setOutput(prev => prev + `\n命令执行失败: ${err}`)
      setIsConnected(false)
      onDisconnect?.()
    }
  }

  async function disconnect() {
    if (!isConnected) return
    
    try {
      await invoke('terminal_disconnect')
    } catch {}
    setIsConnected(false)
    setOutput('')
    setCurrentDir('~')
    setError(null)
    onDisconnect?.()
  }

  async function fetchCompletions(prefix: string) {
    if (!prefix) {
      setShowCompletions(false)
      return
    }
    
    try {
      const result = await invoke<string>('terminal_send', { 
        command: `compgen -f -- "${prefix}" 2>/dev/null || ls -d "${prefix}"* 2>/dev/null || echo ""`
      })
      const items = result.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('command not found'))
      setCompletions(items)
      setCompletionIndex(0)
      setShowCompletions(items.length > 0)
    } catch {
      setShowCompletions(false)
    }
  }

  function applyCompletion() {
    if (!showCompletions || completions.length === 0) return
    
    const words = input.split(' ')
    const selected = completions[completionIndex] || completions[0]
    
    if (words.length > 1) {
      words[words.length - 1] = selected
    } else {
      words[0] = selected
    }
    
    setInput(words.join(' ') + ' ')
    setShowCompletions(false)
    setCompletions([])
  }

  async function handleFileUpload() {
    try {
      const selected = await open({
        directory: false,
        multiple: true,
        filters: [
          { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'svg', 'gif'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })

      if (!selected) return

      const files = Array.isArray(selected) ? selected : [selected]
      const newUploadFiles: UploadFile[] = files.map(file => ({
        name: file.split('/').pop() || file,
        path: file,
        size: 0,
        status: 'pending',
        progress: 0,
      }))

      setUploadFiles(newUploadFiles)
      setShowUploadPanel(true)

      for (const file of newUploadFiles) {
        setUploadFiles(prev => prev.map(f => 
          f.name === file.name ? { ...f, status: 'uploading' } : f
        ))

        try {
          const targetPath = currentDir === '~' 
            ? (defaultRemotePath || '/home/wangchuan') 
            : currentDir
          await invoke('terminal_upload_file', {
            localPath: file.path,
            remotePath: targetPath,
            host: server.host,
            username: server.username,
            password: server.password,
            port: server.port,
          })

          setUploadFiles(prev => prev.map(f => 
            f.name === file.name ? { ...f, status: 'done', progress: 100 } : f
          ))

          setOutput(prev => prev + `\n✅ 文件上传成功: ${file.name}`)
        } catch (err) {
          setUploadFiles(prev => prev.map(f => 
            f.name === file.name ? { ...f, status: 'error' } : f
          ))
          setOutput(prev => prev + `\n❌ 文件上传失败: ${file.name} - ${err}`)
        }
      }

      setTimeout(() => {
        setShowUploadPanel(false)
        setUploadFiles([])
      }, 3000)
    } catch (err) {
      console.error('文件选择失败:', err)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (showCompletions) {
      if (e.key === 'Tab') {
        e.preventDefault()
        if (completions.length > 0) {
          const newIndex = completionIndex < completions.length - 1 ? completionIndex + 1 : 0
          setCompletionIndex(newIndex)
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        applyCompletion()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const newIndex = completionIndex > 0 ? completionIndex - 1 : completions.length - 1
        setCompletionIndex(newIndex)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const newIndex = completionIndex < completions.length - 1 ? completionIndex + 1 : 0
        setCompletionIndex(newIndex)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setShowCompletions(false)
        setCompletions([])
      } else {
        setShowCompletions(false)
        setCompletions([])
      }
      return
    }

    if (e.key === 'Enter') {
      sendCommand(input)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const words = input.split(' ')
      const lastWord = words[words.length - 1] || ''
      fetchCompletions(lastWord)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length > 0) {
        const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex
        setHistoryIndex(newIndex)
        setInput(history[history.length - 1 - newIndex])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1
        setHistoryIndex(newIndex)
        setInput(history[history.length - 1 - newIndex])
      } else if (historyIndex === 0) {
        setHistoryIndex(-1)
        setInput('')
      }
    }
  }

  function handleTerminalClick() {
    inputRef.current?.focus()
  }

  return (
    <div className="terminal-container">
      <div className="terminal-header">
        <div className="terminal-title">
          <span>🖥️</span>
          <span>{server.name} - {server.host}:{server.port}</span>
        </div>
        <div className="terminal-controls">
          <button 
            className={`btn-secondary ${isConnected ? 'active' : ''}`} 
            onClick={connect}
            disabled={isConnecting || isConnected}
          >
            {isConnecting ? '⏳' : isConnected ? '✅' : '🔌'} {isConnected ? '已连接' : isConnecting ? '连接中...' : '连接'}
          </button>
          <button className="btn-secondary" onClick={disconnect} disabled={!isConnected}>
            ❌ 断开
          </button>
          <button 
            className="btn-secondary" 
            onClick={handleFileUpload}
            disabled={!isConnected}
            title="上传文件"
          >
            📤 上传文件
          </button>
        </div>
      </div>

      {error && (
        <div className="terminal-error">
          <span className="error-icon">⚠️</span>
          <span className="error-text">{error}</span>
          <button className="error-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {showUploadPanel && uploadFiles.length > 0 && (
        <div className="terminal-upload-area">
          {uploadFiles.map(file => (
            <div key={file.name} className="terminal-upload-file">
              <span className="terminal-upload-file-name">{file.name}</span>
              <span className="terminal-upload-file-status">
                {file.status === 'pending' && '等待上传...'}
                {file.status === 'uploading' && `${file.progress}%`}
                {file.status === 'done' && '✓ 上传成功'}
                {file.status === 'error' && '✗ 上传失败'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="terminal-body" ref={terminalBodyRef} onClick={handleTerminalClick}>
        <div className="terminal-output-wrapper" ref={outputRef}>
          <pre className="terminal-output">{output}</pre>
        </div>
        
        {isConnected && (
          <>
            {showCompletions && completions.length > 0 && (
              <div className="terminal-completions">
                {completions.map((item, index) => (
                  <div
                    key={item}
                    className={`completion-item ${index === completionIndex ? 'selected' : ''}`}
                    onClick={() => {
                      setCompletionIndex(index)
                      applyCompletion()
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            )}
            <div className="terminal-input-line">
              <span className="terminal-prompt">
                <span className="prompt-user">{server.username}</span>
                <span className="prompt-separator">@</span>
                <span className="prompt-host">{server.host}</span>
                <span className="prompt-colon">:</span>
                <span className="prompt-path">{currentDir}</span>
                <span className="prompt-symbol">$</span>
              </span>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="terminal-input"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default Terminal