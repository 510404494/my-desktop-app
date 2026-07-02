import { useState, useEffect, useRef, useCallback } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import JSONEditor from '@json-editor/json-editor'
import type { DeviceConfig, DeviceCategory } from './types'
import PicNav from './components/ImageNav'
import './App.css'

type ViewMode = 'form' | 'raw' | 'tree'
type PageMode = 'json' | 'images'

function App() {
  const [categories, setCategories] = useState<DeviceCategory[]>([])
  const [selectedDevice, setSelectedDevice] = useState<DeviceConfig | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('form')
  const [rawJson, setRawJson] = useState('')
  const [treeData, setTreeData] = useState<string>('')
  const [pageMode, setPageMode] = useState<PageMode>('json')
  const editorRef = useRef<HTMLDivElement>(null)
  const editorInstance = useRef<JSONEditor | null>(null)

  const [scanPathInput, setScanPathInput] = useState('')
  const [scanResult, setScanResult] = useState<{ success: boolean; message: string; count?: number } | null>(null)
  const [scanLoading, setScanLoading] = useState(false)

  useEffect(() => {
    initDatabase()
    loadConfig()
  }, [])

  async function initDatabase() {
    if (!isTauri()) return
    try {
      await invoke('init_db')
    } catch {}
  }

  const destroyEditor = useCallback(() => {
    if (editorInstance.current) {
      try {
        editorInstance.current.destroy()
      } catch {}
      editorInstance.current = null
    }
  }, [])

  useEffect(() => {
    if (selectedDevice && editorRef.current && viewMode === 'form') {
      destroyEditor()

      try {
        const schema = generateSimpleSchema(selectedDevice.data)

        editorInstance.current = new JSONEditor(editorRef.current, {
          schema,
          startval: selectedDevice.data,
          theme: 'bootstrap4',
          iconlib: 'fontawesome5',
          compact: true,
        })

        editorInstance.current.on('change', () => {
          if (editorInstance.current && selectedDevice) {
            try {
              const newData = editorInstance.current.getValue()
              saveDevice(selectedDevice.filePath, newData)
            } catch (err) {
              console.error('Auto-save failed:', err)
            }
          }
        })
      } catch (err) {
        console.error('Editor init failed:', err)
        setError('表单渲染失败，请使用原始模式编辑')
      }
    }

    if (viewMode === 'raw' && selectedDevice) {
      setRawJson(JSON.stringify(selectedDevice.data, null, 2))
    }

    if (viewMode === 'tree' && selectedDevice) {
      setTreeData(renderTree(selectedDevice.data, 0))
    }

    return () => destroyEditor()
  }, [selectedDevice, viewMode, destroyEditor])

  function isComplexJson(data: unknown): boolean {
    if (data === null || typeof data !== 'object') return false
    if (Array.isArray(data)) return true

    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length > 10) return true

    for (const [, value] of entries) {
      if (Array.isArray(value)) return true
      if (typeof value === 'object' && value !== null) {
        const subEntries = Object.entries(value as Record<string, unknown>)
        if (subEntries.length > 5) return true
      }
    }
    return false
  }

  function renderTree(data: unknown, indent: number): string {
    const prefix = '  '.repeat(indent)
    let result = ''

    if (Array.isArray(data)) {
      result += `${prefix}[\n`
      data.forEach((item, i) => {
        result += renderTree(item, indent + 1)
        if (i < data.length - 1) result += ',\n'
      })
      result += `\n${prefix}]`
    } else if (data !== null && typeof data === 'object') {
      result += `${prefix}{\n`
      const entries = Object.entries(data as Record<string, unknown>)
      entries.forEach(([key, value], i) => {
        result += `${prefix}  "${key}": `
        if (typeof value === 'string') {
          result += `"${value}"`
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          result += String(value)
        } else if (value === null) {
          result += 'null'
        } else {
          result += renderTree(value, indent + 1)
        }
        if (i < entries.length - 1) result += ','
        result += '\n'
      })
      result += `${prefix}}`
    } else if (typeof data === 'string') {
      result += `"${data}"`
    } else {
      result += String(data)
    }

    return result
  }

  function generateSimpleSchema(data: unknown): Record<string, unknown> {
    if (data === null || data === undefined) {
      return { type: 'string', title: 'Value' }
    }

    if (Array.isArray(data)) {
      return {
        type: 'string',
        title: 'Array (JSON)',
        format: 'textarea',
      }
    }

    if (typeof data === 'object') {
      const entries = Object.entries(data as Record<string, unknown>)

      if (entries.length > 15) {
        return {
          type: 'string',
          title: 'Object (JSON)',
          format: 'textarea',
        }
      }

      const properties: Record<string, unknown> = {}
      for (const [key, value] of entries) {
        if (value === null || value === undefined) {
          properties[key] = { type: 'string', title: key }
        } else if (Array.isArray(value) || (typeof value === 'object' && Object.keys(value as object).length > 5)) {
          properties[key] = {
            type: 'string',
            title: key,
            format: 'textarea',
          }
        } else {
          properties[key] = {
            type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
            title: key,
          }
        }
      }
      return { type: 'object', properties }
    }

    return { type: typeof data === 'number' ? 'number' : typeof data === 'boolean' ? 'boolean' : 'string' }
  }

  async function loadConfig() {
    try {
      const config = await invoke<{ scanPaths: string[] }>('load_config')
      if (config.scanPaths[0]) {
        scanDirectory(config.scanPaths[0])
      }
    } catch {}
  }

  async function scanDirectory(path: string) {
    try {
      const devices = await invoke<DeviceConfig[]>('scan_directory', { path })
      const grouped = groupByType(devices)
      setCategories(grouped)
      await invoke('save_config', { scanPaths: [path] })
    } catch (err) {
      setError(`扫描失败: ${err}`)
    }
  }

  function groupByType(devices: DeviceConfig[]): DeviceCategory[] {
    const map = new Map<string, DeviceConfig[]>()
    devices.forEach(d => {
      const list = map.get(d.type) || []
      list.push(d)
      map.set(d.type, list)
    })
    return Array.from(map.entries()).map(([name, devices]) => ({ name, devices }))
  }

  async function saveDevice(filePath: string, data: Record<string, unknown>) {
    try {
      await invoke('save_device', { filePath, data })
    } catch (err) {
      console.error('Save failed:', err)
    }
  }

  async function handleSelectFolder() {
    const selected = await open({ directory: true })
    if (selected) {
      scanDirectory(selected)
    }
  }

  async function handleOpenFile() {
    const selected = await open({
      filters: [{ name: 'JSON', extensions: ['json'] }],
      multiple: false,
    })
    if (selected) {
      try {
        setError(null)
        const device = await invoke<DeviceConfig>('load_file', { path: selected })
        setSelectedDevice(device)
        setViewMode(isComplexJson(device.data) ? 'raw' : 'form')
      } catch (err) {
        setError(`打开文件失败: ${err}`)
      }
    }
  }

  async function handleFetchUrl() {
    if (!urlInput.trim()) return
    setLoading(true)
    setError(null)
    try {
      const data = await invoke<Record<string, unknown>>('fetch_json_from_url', { url: urlInput })
      const fileName = urlInput.split('/').pop()?.split('?')[0] || 'URL Import'
      const name = fileName.replace(/\.json$/i, '') || 'URL Import'
      const device: DeviceConfig = {
        id: crypto.randomUUID(),
        name,
        type: 'url',
        filePath: urlInput,
        data,
      }
      setSelectedDevice(device)
      setViewMode(isComplexJson(data) ? 'raw' : 'form')
    } catch (err) {
      setError(`获取URL失败: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleExportJson() {
    if (!selectedDevice) return
    try {
      const path = await save({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        defaultPath: `${selectedDevice.name}.json`,
      })
      if (path) {
        await invoke('export_to_json', { data: selectedDevice.data, path })
      }
    } catch (err) {
      setError(`导出失败: ${err}`)
    }
  }

  async function handleExportCsv() {
    if (!selectedDevice) return
    try {
      const path = await save({
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        defaultPath: `${selectedDevice.name}.csv`,
      })
      if (path) {
        await invoke('export_to_csv', { data: selectedDevice.data, path })
      }
    } catch (err) {
      setError(`导出失败: ${err}`)
    }
  }

  function handleRefresh() {
    setError(null)
    setViewMode('form')
    if (selectedDevice) {
      setSelectedDevice({ ...selectedDevice })
    }
  }

  function handleRawSave() {
    if (!selectedDevice) return
    try {
      const data = JSON.parse(rawJson)
      setSelectedDevice({ ...selectedDevice, data })
      saveDevice(selectedDevice.filePath, data)
      setError(null)
    } catch (err) {
      setError(`JSON格式错误: ${err}`)
    }
  }

  async function testScan() {
    if (!isTauri) {
      setScanResult({ success: false, message: '请在 Tauri 桌面应用中运行此功能' })
      return
    }

    if (!scanPathInput.trim()) {
      setScanResult({ success: false, message: '请输入扫描路径' })
      return
    }

    setScanLoading(true)
    setScanResult(null)

    try {
      const devices = await invoke<DeviceConfig[]>('scan_directory', { path: scanPathInput })
      setScanResult({
        success: true,
        message: `扫描成功！共发现 ${devices.length} 个 JSON 文件`,
        count: devices.length,
      })
    } catch (err) {
      setScanResult({ success: false, message: `扫描失败: ${err}` })
    } finally {
      setScanLoading(false)
    }
  }

  const filteredCategories = categories.map(cat => ({
    ...cat,
    devices: cat.devices.filter(d =>
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.type.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(cat => cat.devices.length > 0)

  return (
    <div className="app">
      <header className="header">
        <div className="toolbar">
          <h1>JSON Editor</h1>
          <nav className="nav-tabs">
            <button
              className={pageMode === 'json' ? 'active' : ''}
              onClick={() => setPageMode('json')}
            >
              📄 JSON
            </button>
            <button
              className={pageMode === 'images' ? 'active' : ''}
              onClick={() => setPageMode('images')}
            >
              🖼️ 图片导航
            </button>
          </nav>
          {pageMode === 'json' && (
            <>
              <button className="btn-primary" onClick={handleSelectFolder}>
                📁 扫描文件夹
              </button>
              <div className="scan-path-input">
                <input
                  type="text"
                  placeholder="输入扫描路径..."
                  value={scanPathInput}
                  onChange={e => setScanPathInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && testScan()}
                />
                <button className="btn-accent" onClick={testScan} disabled={scanLoading}>
                  {scanLoading ? '⏳' : '🔍'} 测试扫描
                </button>
              </div>
              {scanResult && (
                <div className={`scan-result ${scanResult.success ? 'success' : 'error'}`}>
                  <span className="result-icon">{scanResult.success ? '✓' : '✗'}</span>
                  <span className="result-message">{scanResult.message}</span>
                </div>
              )}
              <button className="btn-primary" onClick={handleOpenFile}>
                📄 打开文件
              </button>
              <div className="url-input">
                <input
                  type="text"
                  placeholder="输入JSON URL..."
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleFetchUrl()}
                />
                <button className="btn-accent" onClick={handleFetchUrl} disabled={loading}>
                  {loading ? '⏳' : '🔗'} 解析
                </button>
              </div>
              <div className="search-box">
                <span>🔍</span>
                <input
                  type="text"
                  placeholder="搜索..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="error-bar">
          <span className="error-icon">⚠️</span>
          <span className="error-text">{error}</span>
          <button className="error-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="main">
        {pageMode === 'images' ? (
          <PicNav />
        ) : (
          <>
            <aside className="sidebar">
              <div className="sidebar-header">
                <h2>设备列表</h2>
                <span className="count-badge">{filteredCategories.reduce((acc, cat) => acc + cat.devices.length, 0)}</span>
              </div>
              <div className="sidebar-content">
                {filteredCategories.map(cat => (
                  <div key={cat.name} className="category">
                    <div className="category-header">
                      <span className="category-icon">📁</span>
                      <h3>{cat.name}</h3>
                      <span className="category-count">{cat.devices.length}</span>
                    </div>
                    <ul>
                      {cat.devices.map(device => (
                        <li
                          key={device.id}
                          className={selectedDevice?.id === device.id ? 'active' : ''}
                          onClick={() => {
                            setSelectedDevice(device)
                            setError(null)
                            setViewMode(isComplexJson(device.data) ? 'raw' : 'form')
                          }}
                        >
                          <span className="device-icon">📋</span>
                          <span className="device-name">{device.name}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </aside>

            <main className="editor-panel">
              {selectedDevice ? (
                <>
                  <div className="editor-header">
                    <div className="editor-info">
                      <h2>{selectedDevice.name}</h2>
                      <span className="badge">{selectedDevice.type}</span>
                    </div>
                    <div className="header-actions">
                      <div className="view-toggle">
                        <button
                          className={viewMode === 'form' ? 'active' : ''}
                          onClick={() => setViewMode('form')}
                        >
                          表单
                        </button>
                        <button
                          className={viewMode === 'raw' ? 'active' : ''}
                          onClick={() => setViewMode('raw')}
                        >
                          原始
                        </button>
                        <button
                          className={viewMode === 'tree' ? 'active' : ''}
                          onClick={() => setViewMode('tree')}
                        >
                          树形
                        </button>
                      </div>
                      <button className="btn-icon-only" onClick={handleRefresh} title="刷新">🔄</button>
                      <button className="btn-secondary" onClick={handleExportJson}>
                        导出 JSON
                      </button>
                      <button className="btn-secondary" onClick={handleExportCsv}>
                        导出 CSV
                      </button>
                    </div>
                  </div>
                  <code className="path-bar">{selectedDevice.filePath}</code>
                  {viewMode === 'form' && (
                    <div ref={editorRef} className="json-editor-container" />
                  )}
                  {viewMode === 'raw' && (
                    <div className="raw-editor">
                      <textarea
                        value={rawJson}
                        onChange={e => setRawJson(e.target.value)}
                        spellCheck={false}
                      />
                      <div className="raw-actions">
                        <button className="btn-primary" onClick={handleRawSave}>
                          💾 保存修改
                        </button>
                      </div>
                    </div>
                  )}
                  {viewMode === 'tree' && (
                    <div className="tree-editor">
                      <pre>{treeData}</pre>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">📝</div>
                  <p>选择设备或打开JSON文件开始编辑</p>
                  <p className="empty-hint">支持本地文件和URL导入</p>
                </div>
              )}
            </main>
          </>
        )}
      </div>

      </div>
  )
}

export default App